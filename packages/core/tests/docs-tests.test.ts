import { readdir, readFile } from 'node:fs/promises';

import { expect, test } from 'vite-plus/test';

/** The repository root. */
const root = new URL('../../../', import.meta.url);

/** The directories that hold tests and the helpers they import. */
const scanned = ['packages', 'examples', 'scripts'];

/** A source that reads a file under docs/ by a path relative to itself. */
const readsDocs = /\.\.\/docs\//u;

/** The pragma that tags every test in a file with `docs`. */
const docsTag = /^\/\/ @module-tag docs$/mu;

/** Every TypeScript or JavaScript source under the scanned directories, by path from the root. */
async function sources(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const directory of scanned) {
    const entries = await readdir(new URL(`${directory}/`, root), { recursive: true });
    for (const entry of entries) {
      const path = `${directory}/${entry}`;
      if (/\.(?:ts|mjs)$/u.test(path) && !/(?:^|\/)(?:node_modules|dist)\//u.test(path)) {
        found.set(path, await readFile(new URL(path, root), 'utf8'));
      }
    }
  }
  return found;
}

/** How an import of `path` ends: its file name with a `.js` or `.mjs` extension, then a quote. */
function importedAs(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.(?:ts|mjs)$/u, '');
  return `/${name}.${path.endsWith('.mjs') ? 'mjs' : 'js'}'`;
}

/** The test files that read docs/, directly or through a helper they import. */
function testsReadingDocs(files: Map<string, string>): string[] {
  const readers = new Set(
    [...files].filter(([, text]) => readsDocs.test(text)).map(([path]) => path),
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const [path, text] of files) {
      if (!readers.has(path) && [...readers].some((reader) => text.includes(importedAs(reader)))) {
        readers.add(path);
        grew = true;
      }
    }
  }
  return [...readers].filter((path) => path.endsWith('.test.ts')).toSorted();
}

// A pull request that changes only documentation runs the tests tagged `docs` in CI instead of the
// Whole suite, so every test that reads a file under docs/ carries the tag, and no other test does.
test('the docs tag marks exactly the tests that read docs/', async () => {
  const files = await sources();
  const tagged = [...files]
    .filter(([path, text]) => path.endsWith('.test.ts') && docsTag.test(text))
    .map(([path]) => path)
    .toSorted();
  expect(tagged).toEqual(testsReadingDocs(files));
});
