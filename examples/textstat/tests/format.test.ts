import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const main = new URL('../dist/src/main.js', import.meta.url);

/** One file, one row, so the encoded document is small enough to assert byte for byte. */
function withOneFile(run: (cwd: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-format-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** The table the row above counts. The action prints the argument as supplied, not resolved. */
const document = {
  metric: 'bytes',
  rows: [{ count: 6, source: 'one.txt' }],
};

test('textstat --format json prints the table as one indented document on stdout', () => {
  withOneFile((cwd) => {
    const result = invoke(main, ['--format', 'json', 'one.txt'], { cwd });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${JSON.stringify(document, null, 2)}\n`);
  });
});

test('textstat --format jsonl prints the table on one line', () => {
  withOneFile((cwd) => {
    const result = invoke(main, ['--format', 'jsonl', 'one.txt'], { cwd });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${JSON.stringify(document)}\n`);
  });
});

test('textstat --format ndjson selects jsonl, the unadvertised alias', () => {
  withOneFile((cwd) => {
    const named = invoke(main, ['--format', 'jsonl', 'one.txt'], { cwd });
    const aliased = invoke(main, ['--format', 'ndjson', 'one.txt'], { cwd });
    expect(aliased).toEqual(named);
  });
});

test('textstat --format json --timing still writes the timing line on stderr', () => {
  withOneFile((cwd) => {
    const result = invoke(main, ['--format', 'json', '--timing', 'one.txt'], {
      cwd,
      env: { TERM: 'xterm-256color' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify(document, null, 2)}\n`);
    expect(result.stderr).toMatch(/^ℹ elapsed: \d+ms\n$/u);
  });
});

test('textstat with no --format prints the table exactly as it did before the plugin', () => {
  withOneFile((cwd) => {
    const result = invoke(main, ['one.txt'], { cwd });
    expect(result).toEqual({ status: 0, stderr: '', stdout: 'BYTES  SOURCE\n    6  one.txt\n' });
  });
});

test("textstat --format yaml is the validator's issue at exit 2", () => {
  withOneFile((cwd) => {
    const result = invoke(main, ['--format', 'yaml', 'one.txt'], { cwd });
    expect(result).toEqual({
      status: 2,
      stderr: 'Invalid input: Option "--format": Supply one of table, json, jsonl.\n',
      stdout: '',
    });
  });
});

test('textstat --format yaml --help still prints the help page, help installed after format', () => {
  withOneFile((cwd) => {
    const withHelp = invoke(main, ['--help'], { cwd });
    const result = invoke(main, ['--format', 'yaml', '--help'], { cwd });
    expect(result).toEqual({ status: 0, stderr: '', stdout: withHelp.stdout });
  });
});

test('textstat --format twice follows the ordinary string-option rule and is rejected', () => {
  withOneFile((cwd) => {
    const result = invoke(main, ['--format', 'json', '--format', 'jsonl', 'one.txt'], { cwd });
    expect(result).toEqual({
      status: 2,
      stderr:
        'Invalid input: Option "--format" can be supplied only once. Remove the repeated option.\n',
      stdout: '',
    });
  });
});

test('textstat --format with no value is the missing-value error', () => {
  withOneFile((cwd) => {
    const result = invoke(main, ['one.txt', '--format'], { cwd });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--format');
  });
});
