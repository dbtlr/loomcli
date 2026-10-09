import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The directory of the nearest `package.json` at or above the working directory, or `undefined`
 * when no `package.json` is at or above it.
 */
export function nearestPackageDirectory(cwd: string): string | undefined {
  let directory = resolve(cwd);
  while (!existsSync(join(directory, 'package.json'))) {
    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
  return directory;
}

/**
 * The package a `loom` command acts on: the directory of the nearest `package.json` at or above
 * the working directory. A monorepo root is its own package, never the set of its members.
 */
export function packageDirectory(cwd: string) {
  const directory = nearestPackageDirectory(cwd);
  if (directory === undefined) {
    throw new Error(`No package.json at or above ${cwd}. Run loom inside a package directory.`);
  }
  return directory;
}
