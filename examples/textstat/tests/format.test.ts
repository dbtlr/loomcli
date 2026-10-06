import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const main = new URL('../dist/main.js', import.meta.url);

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

/** The rows the source above produces. The action prints the argument as supplied, not resolved. */
const rows = [{ count: 6, source: 'one.txt' }];

test.each(['--format', '-f'])(
  'textstat %s json prints the rows as one indented array on stdout',
  (spelling) => {
    withOneFile((cwd) => {
      const result = invoke(main, [spelling, 'json', 'one.txt'], { cwd });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe(`${JSON.stringify(rows, null, 2)}\n`);
    });
  },
);

test('textstat --format jsonl prints one line per row', () => {
  withOneFile((cwd) => {
    const result = invoke(main, ['--format', 'jsonl', 'one.txt'], { cwd });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
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
    expect(result.stdout).toBe(`${JSON.stringify(rows, null, 2)}\n`);
    expect(result.stderr).toMatch(/^ℹ elapsed: \d+ms\n$/u);
  });
});

test('textstat with no --format prints the table exactly as it did before the plugin', () => {
  withOneFile((cwd) => {
    const result = invoke(main, ['one.txt'], { cwd });
    expect(result).toEqual({ status: 0, stderr: '', stdout: 'COUNT  SOURCE\n    6  one.txt\n' });
  });
});

test("textstat --format yaml is the validator's issue at exit 2", () => {
  withOneFile((cwd) => {
    const result = invoke(main, ['--format', 'yaml', 'one.txt'], { cwd });
    expect(result).toEqual({
      status: 2,
      stderr:
        'textstat: Option "--format": Supply one of table, json, jsonl.\nRun "textstat --help" to see the usage.\n',
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
        'textstat: Option "--format" can be supplied only once. Remove the repeated option.\nRun "textstat --help" to see the usage.\n',
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

/** Help's hint for the root, which every usage failure carries. */
const usage = String.raw`"hints":["Run \"textstat --help\" to see the usage."]`;

test.each(['json', 'jsonl'])(
  'textstat --format %s with an invalid metric writes the invalid-input line alone and exits 2',
  (selected) => {
    withOneFile((cwd) => {
      expect(invoke(main, ['--format', selected, '--metric', 'nope', 'one.txt'], { cwd })).toEqual({
        status: 2,
        stderr: `{"error":{"code":"invalid-input","exitCode":2,"message":"Option \\"--metric\\": Expected one of: bytes, words, lines.",${usage}}}\n`,
        stdout: '',
      });
    });
  },
);

test('textstat --format json --bogus writes the unknown-option line, because core validates --format under the held fault', () => {
  withOneFile((cwd) => {
    const result = invoke(main, ['--format', 'json', '--bogus', 'one.txt'], { cwd });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    const line: { error: { code: string; exitCode: number } } = JSON.parse(result.stderr);
    expect(line.error).toMatchObject({ code: 'unknown-option', exitCode: 2 });
  });
});

test('textstat writes its text diagnostic when no --format selects an encoded view, or a rejected one selects nothing', () => {
  withOneFile((cwd) => {
    const metric = invoke(main, ['--metric', 'nope', 'one.txt'], { cwd });
    expect(metric.status).toBe(2);
    expect(metric.stderr).toMatch(
      /^textstat: Option "--metric": Expected one of: bytes, words, lines\.\n/u,
    );
    const rejected = invoke(main, ['--format', 'yaml', 'one.txt'], { cwd });
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toMatch(
      /^textstat: Option "--format": Supply one of table, json, jsonl\.\n/u,
    );
  });
});
