import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';

import { packageName } from '../src/constants.js';

test('the package name constant is the name the manifest publishes', () => {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  expect(manifest).toHaveProperty('name', packageName);
});
