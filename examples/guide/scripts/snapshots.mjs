import { readdir } from 'node:fs/promises';

/**
 * The chapter snapshots under a `src` directory: each subdirectory that holds a `tsconfig.json`.
 * A snapshot compiles as its own TypeScript project, because a modular application augments
 * core's `Register` interface and one project allows a single registration.
 */
export async function snapshotNames(source) {
  const entries = await readdir(source, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const files = await readdir(new URL(`${entry.name}/`, source));
      if (files.includes('tsconfig.json')) {
        names.push(entry.name);
      }
    }
  }
  return names.toSorted((left, right) => left.localeCompare(right));
}
