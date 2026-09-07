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

export function git(root: string, args: string[]) {
  const result = spawnSync('git', ['--literal-pathspecs', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export function readRegularFile(root: string, path: string) {
  const absolute = join(root, path);
  if (!lstatSync(absolute).isFile()) {
    throw new Error(`${path}: expected a regular file.`);
  }
  return readFileSync(absolute, 'utf8');
}

export function readLibraries(root: string) {
  const libraries = readdirSync(join(root, 'packages'), { withFileTypes: true }).flatMap(
    (entry) => {
      if (entry.isSymbolicLink()) {
        throw new Error(`packages/${entry.name}: symlinks are not supported.`);
      }
      if (!entry.isDirectory()) {
        return [];
      }
      const directory = `packages/${entry.name}`;
      const path = `${directory}/package.json`;
      const source = readRegularFile(root, path);
      const input: unknown = JSON.parse(source);
      if (z.object({ private: z.boolean().optional() }).parse(input).private) {
        return [];
      }
      const manifest = manifestSchema.parse(input);
      return [{ directory, manifest, path, source }];
    },
  );
  if (libraries.length === 0) {
    throw new Error('No publishable libraries in packages/*.');
  }
  if (new Set(libraries.map((library) => library.manifest.name)).size !== libraries.length) {
    throw new Error('Publishable library names must be unique.');
  }
  const versions = new Set(libraries.map((library) => library.manifest.version));
  if (versions.size !== 1) {
    throw new Error('Publishable library versions must match.');
  }
  return libraries;
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
