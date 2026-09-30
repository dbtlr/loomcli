import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

const manifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  name: z.string().min(1),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  private: z.boolean().optional(),
  version: z.string(),
});

function gitBytes(root: string, args: string[]) {
  const result = spawnSync('git', ['--literal-pathspecs', ...args], {
    cwd: root,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString('utf8').trim()}`);
  }
  return result.stdout;
}

export function git(root: string, args: string[]) {
  return gitBytes(root, args).toString('utf8');
}

export function readDirectory(root: string, path: string, ref?: string) {
  if (ref === undefined) {
    return readdirSync(join(root, path), { withFileTypes: true });
  }
  return git(root, ['ls-tree', '-z', `${ref}:${path}`])
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

export function readRegularFileBytes(root: string, path: string, ref?: string) {
  if (ref !== undefined) {
    const entry = git(root, ['ls-tree', '-z', ref, '--', path]);
    if (!/^100(?:644|755) blob /u.test(entry)) {
      throw new Error(`${path}: expected a regular file.`);
    }
    return gitBytes(root, ['show', `${ref}:${path}`]);
  }
  const absolute = join(root, path);
  if (!lstatSync(absolute).isFile()) {
    throw new Error(`${path}: expected a regular file.`);
  }
  return readFileSync(absolute);
}

export function readRegularFile(root: string, path: string, ref?: string) {
  return readRegularFileBytes(root, path, ref).toString('utf8');
}

// A shallow clone hides the commits the material baseline and the release notes are derived from.
export function requireFullHistory(root: string) {
  if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    throw new Error('Release preparation requires full Git history.');
  }
}

// The non-private manifests under packages/, empty when the ref carries no packages tree.
export function readParticipants(root: string, ref?: string) {
  if (
    ref !== undefined &&
    !git(root, ['ls-tree', '-z', ref, '--', 'packages']).startsWith('040000 tree ')
  ) {
    return [];
  }
  return readDirectory(root, 'packages', ref).flatMap((entry) => {
    if (entry.isSymbolicLink()) {
      throw new Error(`packages/${entry.name}: symlinks are not supported.`);
    }
    if (!entry.isDirectory()) {
      return [];
    }
    const directory = `packages/${entry.name}`;
    const path = `${directory}/package.json`;
    const source = readRegularFile(root, path, ref);
    const input: unknown = JSON.parse(source);
    if (z.object({ private: z.boolean().optional() }).parse(input).private) {
      return [];
    }
    const manifest = manifestSchema.parse(input);
    return [{ directory, manifest, path, source }];
  });
}

// Participating libraries share one name space and one version, because only a release cut moves them.
export function requireCoherentLibraries(
  libraries: [ReturnType<typeof readParticipants>[number], ...ReturnType<typeof readParticipants>],
) {
  if (new Set(libraries.map((library) => library.manifest.name)).size !== libraries.length) {
    throw new Error('Publishable library names must be unique.');
  }
  const versions = new Set(libraries.map((library) => library.manifest.version));
  if (versions.size !== 1) {
    throw new Error('Publishable library versions must match.');
  }
  return libraries;
}

export function readLibraries(root: string, ref?: string) {
  const [first, ...rest] = readParticipants(root, ref);
  if (first === undefined) {
    throw new Error('No publishable libraries in packages/*.');
  }
  return requireCoherentLibraries([first, ...rest]);
}

export function currentVersion(libraries: ReturnType<typeof readLibraries>) {
  const version = libraries[0]?.manifest.version;
  const match = /^0\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/u.exec(version ?? '');
  if (!match) {
    throw new Error('Library versions must be stable 0.x versions.');
  }
  const minor = Number(match.groups?.minor);
  const patch = Number(match.groups?.patch);
  if (!Number.isSafeInteger(minor + 1) || !Number.isSafeInteger(patch + 1)) {
    throw new Error('Library version components are too large.');
  }
  return { minor, patch, text: `0.${minor}.${patch}` };
}
