import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const main = new URL('../dist/src/main.js', import.meta.url);

/** A pinned document, checked by hand against the manifest contract's rules. */
function pinned(name: string): string {
  return readFileSync(new URL(`fixtures/manifest/${name}.json`, import.meta.url), 'utf8');
}

test('jsonkit --manifest prints the whole application, omitting the hidden paths and debug', () => {
  expect(invoke(main, ['--manifest'])).toEqual({ status: 0, stderr: '', stdout: pinned('root') });
});

test('jsonkit get --manifest prints the get slice while its required path is missing', () => {
  expect(invoke(main, ['get', '--manifest'])).toEqual({
    status: 0,
    stderr: '',
    stdout: pinned('get'),
  });
});

test('jsonkit --help --manifest prints help and --version --manifest the version, by installation order', () => {
  expect(invoke(main, ['--help', '--manifest']).stdout).toMatch(/^jsonkit · /u);
  expect(invoke(main, ['--version', '--manifest']).stdout).toBe('jsonkit v0.0.0\n');
});
