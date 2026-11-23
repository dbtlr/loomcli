/*
 * No declaration the package publishes names valibot, so an author's type check loads none of its
 * declarations through the pack. The tests run against the built dist, so this reads the emitted
 * `.d.ts` files.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

const dist = fileURLToPath(new URL('../dist', import.meta.url));

/** Every declaration file under a folder, as a path relative to it. */
function declarationFiles(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.d.ts'))
    .map((entry) => join(entry.parentPath, entry.name).slice(folder.length + 1));
}

test('no emitted declaration names valibot', () => {
  const files = declarationFiles(dist);
  expect(files.length).toBeGreaterThan(0);
  const naming = files.filter((file) => /valibot/iu.test(readFileSync(join(dist, file), 'utf8')));
  expect(naming).toEqual([]);
});
