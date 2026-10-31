import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { run } from './run.js';

/** One file and an empty nonterminal stdin, with a small encoded document to assert byte for byte. */
async function withOneFile(body: (cwd: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-format-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    await body(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** The expected file and empty-pipe rows. File names retain their supplied spelling. */
const rows = [
  { count: 6, source: 'one.txt' },
  { count: 0, source: 'stdin' },
];

test.each(['--format', '-f'])(
  'textstat %s json prints the rows as one indented array on stdout',
  async (spelling) => {
    await withOneFile(async (cwd) => {
      const result = await run([spelling, 'json', 'one.txt'], { cwd });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe(`${JSON.stringify(rows, null, 2)}\n`);
    });
  },
);

test('textstat --format jsonl prints one line per row', async () => {
  await withOneFile(async (cwd) => {
    const result = await run(['--format', 'jsonl', 'one.txt'], { cwd });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  });
});

test('textstat --format ndjson selects jsonl, the unadvertised alias', async () => {
  await withOneFile(async (cwd) => {
    const named = await run(['--format', 'jsonl', 'one.txt'], { cwd });
    const aliased = await run(['--format', 'ndjson', 'one.txt'], { cwd });
    expect(aliased).toEqual(named);
  });
});

test('textstat --format json --timing still writes the timing line on stderr', async () => {
  await withOneFile(async (cwd) => {
    const result = await run(['--format', 'json', '--timing', 'one.txt'], {
      cwd,
      env: { TERM: 'xterm-256color' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify(rows, null, 2)}\n`);
    expect(result.stderr).toMatch(/^ℹ elapsed: \d+ms\n$/u);
  });
});

test('textstat with no --format prints the file and empty pipe as a table', async () => {
  await withOneFile(async (cwd) => {
    const result = await run(['one.txt'], { cwd });
    expect(result).toEqual({
      status: 0,
      stderr: '',
      stdout: 'COUNT  SOURCE\n    6  one.txt\n    0  stdin\n',
    });
  });
});

test("textstat --format yaml is the validator's issue at exit 2", async () => {
  await withOneFile(async (cwd) => {
    const result = await run(['--format', 'yaml', 'one.txt'], { cwd });
    expect(result).toEqual({
      status: 2,
      stderr:
        'textstat: Option "--format": Supply one of table, json, jsonl.\nRun "textstat --help" to see the usage.\n',
      stdout: '',
    });
  });
});

test('textstat --format yaml --help still prints the help page, help installed after format', async () => {
  await withOneFile(async (cwd) => {
    const withHelp = await run(['--help'], { cwd });
    const result = await run(['--format', 'yaml', '--help'], { cwd });
    expect(result).toEqual({ status: 0, stderr: '', stdout: withHelp.stdout });
  });
});

test('textstat --format twice follows the ordinary string-option rule and is rejected', async () => {
  await withOneFile(async (cwd) => {
    const result = await run(['--format', 'json', '--format', 'jsonl', 'one.txt'], { cwd });
    expect(result).toEqual({
      status: 2,
      stderr:
        'textstat: Option "--format" can be supplied only once. Remove the repeated option.\nRun "textstat --help" to see the usage.\n',
      stdout: '',
    });
  });
});

test('textstat --format with no value is the missing-value error', async () => {
  await withOneFile(async (cwd) => {
    const result = await run(['one.txt', '--format'], { cwd });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--format');
  });
});

/** Help's hint for the root, which every usage failure carries. */
const usage = String.raw`"hints":["Run \"textstat --help\" to see the usage."]`;

test.each(['json', 'jsonl'])(
  'textstat --format %s with an invalid metric writes the invalid-input line alone and exits 2',
  async (selected) => {
    await withOneFile(async (cwd) => {
      await expect(
        run(['--format', selected, '--metric', 'nope', 'one.txt'], { cwd }),
      ).resolves.toEqual({
        status: 2,
        stderr: `{"error":{"code":"invalid-input","exitCode":2,"message":"Option \\"--metric\\": Expected one of: bytes, words, lines.",${usage}}}\n`,
        stdout: '',
      });
    });
  },
);

test('textstat --format json --bogus writes the unknown-option line, because core validates --format under the held fault', async () => {
  await withOneFile(async (cwd) => {
    const result = await run(['--format', 'json', '--bogus', 'one.txt'], { cwd });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    const line: { error: { code: string; exitCode: number } } = JSON.parse(result.stderr);
    expect(line.error).toMatchObject({ code: 'unknown-option', exitCode: 2 });
  });
});

test('textstat --format json -c with a missing file writes the configuration failure as the JSON line, because core validates --format under the held input-source fault', async () => {
  await withOneFile(async (cwd) => {
    await expect(
      run(['--format', 'json', '-c', 'missing.json', 'one.txt'], { cwd }),
    ).resolves.toEqual({
      status: 2,
      stderr: `{"error":{"code":"invalid-input","exitCode":2,"message":"Option \\"--config\\": File \\"missing.json\\" does not exist. Supply the path of an existing file.",${usage}}}\n`,
      stdout: '',
    });
  });
});

test('textstat writes its text diagnostic when no --format selects an encoded view, or a rejected one selects nothing', async () => {
  await withOneFile(async (cwd) => {
    const metric = await run(['--metric', 'nope', 'one.txt'], { cwd });
    expect(metric.status).toBe(2);
    expect(metric.stderr).toMatch(
      /^textstat: Option "--metric": Expected one of: bytes, words, lines\.\n/u,
    );
    const rejected = await run(['--format', 'yaml', 'one.txt'], { cwd });
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toMatch(
      /^textstat: Option "--format": Supply one of table, json, jsonl\.\n/u,
    );
  });
});
