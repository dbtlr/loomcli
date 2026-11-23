import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';

/** The top-level subpaths the manifest exports, such as `completion`, each one plugin or view. */
function exportedSubpaths(): string[] {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  if (typeof manifest !== 'object' || manifest === null || !('exports' in manifest)) {
    throw new Error('packages/plugins/package.json declares no exports.');
  }
  const { exports } = manifest;
  if (typeof exports !== 'object' || exports === null) {
    throw new Error('packages/plugins/package.json exports is not an object.');
  }
  return Object.keys(exports)
    .map((key) => key.replace(/^\.\//u, ''))
    .filter((subpath) => subpath !== '.' && !subpath.includes('/'));
}

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

// A subpath the README leaves out is one an author reading npm cannot find, as completion was.
test.each(exportedSubpaths())('the package README names @loomcli/plugins/%s', (subpath) => {
  expect(readme).toContain(`\`@loomcli/plugins/${subpath}\``);
});
