import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { boolean, looseObject, minLength, object, optional, pipe, string } from 'valibot';
import type { InferOutput } from 'valibot';

import { stringMap } from './json-object.js';
import { parseManifest } from './manifest.js';
import {
  cannotRun,
  expectedRegularFile,
  gitFailed,
  gitMissing,
  libraryNamesRepeat,
  libraryVersionsDiffer,
  noLibraries,
  outsideWorkspace,
  releaseShallow,
  symlinkedPackage,
  unstableLibraryVersions,
} from './messages.js';
import { parseOrThrow } from './parse-or-throw.js';
import type { RunHost } from './run-host.js';
import { systemErrorCode } from './system-error.js';
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
 * Settings that change what git prints. A signature printed before the format output, or a log that
 * follows a fragment across a rename, would misplace it, and `diff.relative` would limit a diff to
 * the working directory and print its paths from there, where `gitPaths` reads them from the top of
 * the work tree, so every call turns them off. No other setting changes how the paths read are
 * spelled: each call whose paths are read passes `-z`, which prints them verbatim whatever
 * `core.quotePath` says, and the other listings, `git status` and `git ls-tree` of one path, are
 * read only for whether they print anything or for a mode.
 */
const neutralSettings = [
  '-c',
  'log.showSignature=false',
  '-c',
  'log.follow=false',
  '-c',
  'diff.relative=false',
];

/**
 * The failure of a git that could not start, in the bin's words: the sentence for a git that is not
 * on the PATH, else the general one with the system error's code. It carries the runtime's error as
 * its cause.
 */
function unstartedGit(error: Error) {
  const code = systemErrorCode(error);
  return new Error(code === 'ENOENT' ? gitMissing : cannotRun('git', code), { cause: error });
}

/**
 * Runs git in the checkout through the run's host and waits for it. The run's signal ends git once
 * the run is cancelled, and a cancelled run starts no git and fails with the signal's reason,
 * which core keeps silent. A git that cannot start fails with the sentence that names why, and one
 * that exits with a failure fails with what it wrote to stderr. A tracked file read at a commit can be large,
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
    throw unstartedGit(exit.error);
  }
  if (exit.kind !== 'exited' || exit.code !== 0) {
    throw new Error(gitFailed(args[0] ?? '', exit.stderr.text.trim()));
  }
  return exit.stdout;
}

/** Runs git and returns its whole output as bytes, for a file read at a commit. */
async function gitBytes(checkout: Checkout, args: string[]) {
  const { bytes } = await gitOutput(checkout, args);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * A path relative to the checkout's root at a revision, in git's `<ref>:<path>` form. Git reads a
 * plain path there from the top of the work tree and one that starts with `./` from the working
 * directory, which is the root, so `./../README.md` names the top's `README.md`.
 */
function atRevision(ref: string, path: string) {
  return `${ref}:./${path}`;
}

/**
 * Loom's own release commands and PR guard read the workspace's `packages/`, `.changes/`,
 * `CHANGELOG.md`, and lockfile where they run, so `command` runs only in the workspace directory,
 * the one that holds `pnpm-workspace.yaml`, at the top of the work tree or below it. Each command
 * checks it before it reads anything else.
 */
export function requireWorkspaceDirectory(root: string, command: string) {
  if (!existsSync(join(root, 'pnpm-workspace.yaml'))) {
    throw new Error(outsideWorkspace(command));
  }
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

/**
 * Where the checkout's root sits in its git work tree: `prefix` is the path from the top of the
 * work tree down to the root, with a trailing `/`, and `up` is the path from the root back up to the
 * top, such as `../`. Both are empty when the root is the top.
 */
export interface Placement {
  readonly prefix: string;
  readonly up: string;
}

/** The checkout's placement, which git prints one line each, empty at the top of the work tree. */
export async function readPlacement(checkout: Checkout): Promise<Placement> {
  const output = await git(checkout, ['rev-parse', '--show-prefix', '--show-cdup']);
  const [prefix = '', up = ''] = output.split('\n').map((line) => line.trim());
  return { prefix, up };
}

/**
 * A path git prints from the top of the work tree, such as a `git diff --name-only` entry, made
 * relative to the checkout's root as every other path the toolchain handles is. A path outside the
 * root climbs to the top first, as `../README.md` does.
 */
export function fromTop(placement: Placement, path: string) {
  return path.startsWith(placement.prefix)
    ? path.slice(placement.prefix.length)
    : `${placement.up}${path}`;
}

/**
 * The paths a git command prints, NUL-separated from the top of the work tree, made relative to the
 * checkout's root.
 */
export async function gitPaths(checkout: Checkout, placement: Placement, args: string[]) {
  const output = await git(checkout, args);
  return output
    .split('\0')
    .filter(Boolean)
    .map((path) => fromTop(placement, path));
}

export async function readDirectory(checkout: Checkout, path: string, ref?: string) {
  if (ref === undefined) {
    return readdirSync(join(checkout.root, path), { withFileTypes: true });
  }
  // Below the top, ls-tree limits even a named tree to the working directory unless --full-tree.
  const listing = await git(checkout, ['ls-tree', '--full-tree', '-z', atRevision(ref, path)]);
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
    throw new Error(expectedRegularFile(path));
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
    throw new Error(expectedRegularFile(path));
  }
  return gitBytes(checkout, ['show', atRevision(ref, path)]);
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
    throw unstartedGit(exit.error);
  }
  return exit.kind === 'exited' && exit.code === 0;
}

export async function isShallow(checkout: Checkout) {
  return (await gitLine(checkout, ['rev-parse', '--is-shallow-repository'])) === 'true';
}

// A shallow clone hides the commits the material baseline and the release notes are derived from.
export async function requireFullHistory(checkout: Checkout) {
  if (await isShallow(checkout)) {
    throw new Error(releaseShallow);
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
      throw new Error(symlinkedPackage(entry.name));
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
    throw new Error(libraryNamesRepeat);
  }
  const versions = new Set(libraries.map((library) => library.manifest.version));
  if (versions.size !== 1) {
    throw new Error(libraryVersionsDiffer);
  }
  return libraries;
}

/** The participating libraries, at least one, sharing one name space and one version. */
export type Libraries = [Participant, ...Participant[]];

export async function readLibraries(checkout: Checkout, ref?: string): Promise<Libraries> {
  const [first, ...rest] = await readParticipants(checkout, ref);
  if (first === undefined) {
    throw new Error(noLibraries);
  }
  return requireCoherentLibraries([first, ...rest]);
}

// The synchronized version every participating library carries, a stable 0.x version.
export function currentVersion(libraries: Libraries) {
  const version = parseVersion(libraries[0]?.manifest.version ?? '');
  if (version?.major !== 0) {
    throw new Error(unstableLibraryVersions);
  }
  return version;
}
