import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test('textstat counts file bytes through the built public package', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    writeFileSync(join(directory, 'two words.txt'), 'é');
    const stdout = execFileSync(
      process.env.LOOM_TEST_RUNTIME ?? 'node',
      [fileURLToPath(new URL('../dist/main.js', import.meta.url)), 'one.txt', 'two words.txt'],
      { cwd: directory, encoding: 'utf8' },
    );
    expect(stdout).toBe('6\tone.txt\n2\ttwo words.txt\n');
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each([
  ['missing-fixture.txt', 'ENOENT'],
  ['.', 'EISDIR'],
])('textstat preserves the file-read reason for %s', (file, reason) => {
  const result = invoke(new URL('../dist/main.js', import.meta.url), [file]);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(`Cannot read file: ${file}: `);
  expect(result.stderr).toContain(reason);
});

test('textstat uses the supplied cwd and supports an explicit hyphenated relative path', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url))).toEqual({
    status: 0,
    stderr: '',
    stdout: '5\t./-notes.txt\n',
  });
});
