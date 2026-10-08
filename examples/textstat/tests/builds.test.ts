import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The bundle the build writes, and the source entry, a source run only Bun runs directly. */
const main = new URL('../dist/main.js', import.meta.url);
const source = new URL('../src/main.ts', import.meta.url);

/** The fixture that prints every fault `check()` returns for textstat's declarations. */
const checked = new URL('fixtures/check.mjs', import.meta.url);

test('textstat declares no fault check() returns, from the bundle and from source', () => {
  const clean = { status: 0, stderr: '', stdout: '[]\n' };
  expect(invoke(checked, ['bundle'])).toEqual(clean);
  expect(invoke(checked, ['source'], { runtime: 'bun' })).toEqual(clean);
});

// A usage error is an operator failure, so the bundle and the source print the same bytes.
test.each([
  [
    ['--bogus', 'one.txt'],
    'textstat: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\nRun "textstat --help" to see the usage.\nRun "textstat --explain" to explain this command.\n',
  ],
  [
    ['--totl', 'one.txt'],
    'textstat: Unknown option "--totl". Did you mean "--total"?\nRun "textstat --help" to see the usage.\nRun "textstat --explain" to explain this command.\n',
  ],
  [
    ['--metric', 'pages', 'one.txt'],
    'textstat: Option "--metric": Expected one of: bytes, words, lines.\nRun "textstat --help" to see the usage.\n',
  ],
])('textstat %j prints the same usage error from the bundle and from source', (argv, stderr) => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-builds-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    const expected = { status: 2, stderr, stdout: '' };
    expect(invoke(main, argv, { cwd: directory })).toEqual(expected);
    expect(invoke(source, argv, { cwd: directory, runtime: 'bun' })).toEqual(expected);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
