import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { boolean, looseObject, minLength, object, optional, pipe, string } from 'valibot';
import type { InferOutput } from 'valibot';

import { stringMap } from './json-object.js';
import { parseManifest } from './manifest.js';
import { parseOrThrow } from './parse-or-throw.js';
import type { RunHost } from './run-host.js';
import { parseVersion } from './version.js';

const dependencyMap = optional(stringMap);

const visibility = object({ private: optional(boolean()) });

const manifestSchema = looseObject({
  dependencies: dependencyMap,
  devDependencies: dependencyMap,
  name: pipe(string(), minLength(1)),
  optionalDependencies: dependencyMap,
  peerDependencies: dependencyMap,
  private: optional(boolean()),
  version: string(),
});

/**
 * Settings that change what history commands print. A signature printed before the format output,
 * or a log that follows a fragment across a rename, would misplace it, so every call turns them off.
 */
const neutralSettings = ['-c', 'log.showSignature=false', '-c', 'log.follow=false'];

/**
 * Runs git in the checkout through the run's host and waits for it. The run's signal ends git once
 * the run is cancelled, and a cancelled run starts no git and fails with the signal's reason,
 * which core keeps silent. A git that cannot start fails with the runtime's error, and one that exits
 * with a failure fails with what it wrote to stderr. A tracked file read at a commit can be large,
 * as a reference document is, and the output is unbounded.
 */
async function gitOutput(checkout: Checkout, args: string[]) {
  const { host, root, signal } = checkout;
  signal.throwIfAborted();
  const exit = await host.spawn('git', [...neutralSettings, '--literal-pathspecs', ...args], {
    cwd: root,
    signal,
  }).exited;
  signal.throwIfAborted();
  if (exit.kind === 'unstarted') {
    throw exit.error;
  }
  if (exit.code !== 0) {
    throw new Error(`git ${args[0]} failed: ${exit.stderr.text.trim()}`);
  }
  return exit.stdout;
}

/** Runs git and returns its whole output as bytes, for a file read at a commit. */
async function gitBytes(checkout: Checkout, args: string[]) {
  const { bytes } = await gitOutput(checkout, args);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** A git checkout the toolchain reads, at `root`, and the run it reads it for, which starts git. */
export interface Checkout extends RunHost {
  readonly root: string;
}

/** Runs git and returns its whole output as text. */
export async function git(checkout: Checkout, args: string[]) {
  const { text } = await gitOutput(checkout, args);
  return text;
}

/** Runs git and returns its output without the whitespace around it, for a one-line answer. */
export async function gitLine(checkout: Checkout, args: string[]) {
  const output = await git(checkout, args);
  return output.trim();
}

export async function readDirectory(checkout: Checkout, path: string, ref?: string) {
  if (ref === undefined) {
    return readdirSync(join(checkout.root, path), { withFileTypes: true });
  }
  const listing = await git(checkout, ['ls-tree', '-z', `${ref}:${path}`]);
  return listing
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf('\t');
      const mode = entry.slice(0, 6);
      return {
        isDirectory: () => mode === '040000',
        isFile: () => mode === '100644' || mode === '100755',
        isSymbolicLink: () => mode === '120000',
        name: entry.slice(tab + 1),
      };
    });
}

/**
 * A regular file in the working tree under the root, read at once. The toolchain's writes read the
 * working tree through it, so the check before a write and the write itself never wait between them.
 */
export function readWorkingFileBytes(root: string, path: string) {
  const absolute = join(root, path);
  if (!lstatSync(absolute).isFile()) {
    throw new Error(`${path}: expected a regular file.`);
  }
  return readFileSync(absolute);
}

/** A regular file in the working tree under the root, read at once as text. */
export function readWorkingFile(root: string, path: string) {
  return readWorkingFileBytes(root, path).toString('utf8');
}

/** A regular file in the checkout's working tree, or at a revision when `ref` names one. */
export async function readRegularFileBytes(checkout: Checkout, path: string, ref?: string) {
  if (ref === undefined) {
    return readWorkingFileBytes(checkout.root, path);
  }
  const entry = await git(checkout, ['ls-tree', '-z', ref, '--', path]);
  if (!/^100(?:644|755) blob /u.test(entry)) {
    throw new Error(`${path}: expected a regular file.`);
  }
  return gitBytes(checkout, ['show', `${ref}:${path}`]);
}

export async function readRegularFile(checkout: Checkout, path: string, ref?: string) {
  const bytes = await readRegularFileBytes(checkout, path, ref);
  return bytes.toString('utf8');
}

// Whether the root sits inside a git work tree; a missing git still fails.
export async function isRepository(checkout: Checkout) {
  const { host, root, signal } = checkout;
  signal.throwIfAborted();
  const exit = await host.spawn('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root,
    signal,
    stderr: 'ignore',
    stdout: 'ignore',
  }).exited;
  signal.throwIfAborted();
  if (exit.kind === 'unstarted') {
    throw exit.error;
  }
  return exit.code === 0;
}

export async function isShallow(checkout: Checkout) {
  return (await gitLine(checkout, ['rev-parse', '--is-shallow-repository'])) === 'true';
}

// A shallow clone hides the commits the material baseline and the release notes are derived from.
export async function requireFullHistory(checkout: Checkout) {
  if (await isShallow(checkout)) {
    throw new Error('Release preparation requires full Git history.');
  }
}

/** One non-private manifest under `packages/`, read from the working tree or a revision. */
export interface Participant {
  directory: string;
  manifest: InferOutput<typeof manifestSchema>;
  path: string;
  source: string;
}

// The non-private manifests under packages/, empty when the ref carries no packages tree.
export async function readParticipants(checkout: Checkout, ref?: string) {
  if (ref !== undefined) {
    const packages = await git(checkout, ['ls-tree', '-z', ref, '--', 'packages']);
    if (!packages.startsWith('040000 tree ')) {
      return [];
    }
  }
  const participants: Participant[] = [];
  for (const entry of await readDirectory(checkout, 'packages', ref)) {
    if (entry.isSymbolicLink()) {
      throw new Error(`packages/${entry.name}: symlinks are not supported.`);
    }
    if (entry.isDirectory()) {
      const directory = `packages/${entry.name}`;
      const path = `${directory}/package.json`;
      const source = await readRegularFile(checkout, path, ref);
      const input = parseManifest(source, path);
      if (!parseOrThrow(visibility, input).private) {
        participants.push({
          directory,
          manifest: parseOrThrow(manifestSchema, input),
          path,
          source,
        });
      }
    }
  }
  return participants;
}

// Participating libraries share one name space and one version, because only a release cut moves them.
export function requireCoherentLibraries(libraries: Libraries) {
  if (new Set(libraries.map((library) => library.manifest.name)).size !== libraries.length) {
    throw new Error('Publishable library names must be unique.');
  }
  const versions = new Set(libraries.map((library) => library.manifest.version));
  if (versions.size !== 1) {
    throw new Error('Publishable library versions must match.');
  }
  return libraries;
}

/** The participating libraries, at least one, sharing one name space and one version. */
export type Libraries = [Participant, ...Participant[]];

export async function readLibraries(checkout: Checkout, ref?: string): Promise<Libraries> {
  const [first, ...rest] = await readParticipants(checkout, ref);
  if (first === undefined) {
    throw new Error('No publishable libraries in packages/*.');
  }
  return requireCoherentLibraries([first, ...rest]);
}

// The synchronized version every participating library carries, a stable 0.x version.
export function currentVersion(libraries: Libraries) {
  const version = parseVersion(libraries[0]?.manifest.version ?? '');
  if (version?.major !== 0) {
    throw new Error('Library versions must be stable 0.x versions.');
  }
  return version;
}
