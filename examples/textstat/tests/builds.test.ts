import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The bundle the build writes, and the source entry, a development build only Bun runs directly. */
const main = new URL('../dist/main.js', import.meta.url);
const source = new URL('../src/main.ts', import.meta.url);

test('the source packet reads development', () => {
  expect(JSON.parse(readFileSync(new URL('../loom.packet.json', import.meta.url), 'utf8'))).toEqual(
    { build: 'development' },
  );
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
