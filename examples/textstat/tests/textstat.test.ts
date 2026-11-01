/*
 * Textstat's tests show how its declaration assembles Loom's parts, one case for each capability
 * its README lists. The packages prove each rule; these cases prove the assembly and teach it.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import type { ProcessHandle } from '@loomcli/core';
import { assertAssembles, mockProcess } from '@loomcli/testing';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';

import { textstat } from '../src/application.js';

/** The folder each run starts in, holding `one.txt` (6 bytes) and `two.txt` (3 bytes). */
let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'loom-textstat-'));
  writeFileSync(join(directory, 'one.txt'), 'hello\n');
  writeFileSync(join(directory, 'two.txt'), 'a b');
});

afterEach(() => {
  rmSync(directory, { force: true, recursive: true });
});

/** Runs textstat in this process from the test's folder, with the environment and stdin a case states. */
async function run(argv: string[], facts: { env?: Record<string, string>; stdin?: Readable } = {}) {
  const mock = mockProcess({ argv, cwd: directory, env: facts.env ?? {}, stdin: '' });
  const handle: ProcessHandle = facts.stdin === undefined ? mock : { ...mock, stdin: facts.stdin };
  const status = await textstat.run({ process: handle });
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

test('textstat assembles with no fault', () => {
  expect(() => {
    assertAssembles(textstat);
  }).not.toThrow();
});

test('the files and piped text count into the table view, with a total row only when asked', async () => {
  await expect(run(['one.txt', 'two.txt'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  SOURCE\n    6  one.txt\n    3  two.txt\n    0  stdin\n',
  });
  const piped = Readable.from(['one two three']);
  const { stdout } = await run(['--metric', 'words', '--total', 'one.txt'], { stdin: piped });
  expect(stdout).toBe('COUNT  SOURCE\n    1  one.txt\n    3  stdin\n    4  total\n');
});

test('the byte threshold arrives by flag, alias, variable, or configuration file', async () => {
  const kept = 'COUNT  SOURCE\n    6  one.txt\n';
  await expect(run(['--min-bytes', '4', 'one.txt', 'two.txt'])).resolves.toMatchObject({
    stdout: kept,
  });
  await expect(run(['--minimum', '4', 'one.txt', 'two.txt'])).resolves.toMatchObject({
    stdout: kept,
  });
  await expect(
    run(['one.txt', 'two.txt'], { env: { TEXTSTAT_MIN_BYTES: '4' } }),
  ).resolves.toMatchObject({ stdout: kept });
  writeFileSync(join(directory, '.textstat.json'), '{ "minBytes": 4 }\n');
  await expect(run(['one.txt', 'two.txt'])).resolves.toMatchObject({ stdout: kept });
  // The flag outranks the variable and the file.
  const flagged = await run(['--min-bytes', '0', 'one.txt', 'two.txt'], {
    env: { TEXTSTAT_MIN_BYTES: '4' },
  });
  expect(flagged.stdout).toContain('two.txt');
});

test('the catalog validators reject a value before the action, naming the variable it came from', async () => {
  await expect(run(['one.txt'], { env: { TEXTSTAT_MIN_BYTES: '-1' } })).resolves.toEqual({
    status: 2,
    stderr:
      'textstat: Option "--min-bytes" (from TEXTSTAT_MIN_BYTES): Expected a whole number of at least 0.\nRun "textstat --help" to see the usage.\n',
    stdout: '',
  });
  const { status, stderr } = await run(['--metric', 'pages', 'one.txt']);
  expect(status).toBe(2);
  expect(stderr).toContain('bytes, words, lines');
});

test('the logging plugin appends one record for each run to textstat.jsonl', async () => {
  const state = join(directory, 'state');
  await expect(run(['one.txt'], { env: { XDG_STATE_HOME: state } })).resolves.toMatchObject({
    status: 0,
    stderr: '',
  });
  const record = JSON.parse(readFileSync(join(state, 'textstat', 'textstat.jsonl'), 'utf8'));
  expect(record).toMatchObject({ level: 'info', message: 'Counted the sources.' });
});

test('the hidden --timing writes its info line to stderr, and help does not list it', async () => {
  const { stderr, stdout } = await run(['--timing', 'one.txt']);
  expect(stdout).toContain('one.txt');
  expect(stderr).toMatch(/elapsed: \d+ms\n$/u);
  const help = await run(['--help']);
  expect(help.stdout).not.toContain('--timing');
});

test('the formatter prints the declared rows as JSON in place of the table', async () => {
  const { stdout } = await run(['--format', 'json', '--total', 'one.txt']);
  expect(JSON.parse(stdout)).toEqual([
    { count: 6, source: 'one.txt' },
    { count: 0, source: 'stdin' },
    { count: 6, source: 'total' },
  ]);
});

test("a read failure prints through textstat's FatalError view, with no table", async () => {
  const failing = new Readable({
    read() {
      this.destroy(new Error('The connection failed.'));
    },
  });
  await expect(run(['one.txt'], { stdin: failing })).resolves.toEqual({
    status: 1,
    stderr:
      'Cannot read stdin: The connection failed. Supply readable files, or pipe text to stdin.\n',
    stdout: '',
  });
});

test('help prints the page its helpCommand values describe, with the formatter’s --format row', async () => {
  const { status, stdout } = await run(['--help']);
  expect(status).toBe(0);
  expect(stdout).toContain('Textstat counts files and piped text in order.');
  expect(stdout).toContain('--format');
  expect(stdout).toContain('textstat --metric words --total *.md');
});

test('the example plugin explains the command without reading a file', async () => {
  const { status, stdout } = await run(['missing.txt', '--explain']);
  expect(status).toBe(0);
  expect(stdout).toContain('Count bytes, words, or lines across text sources.');
});

test('the manifest, suggestions, and inspect() describe the same assembled graph', async () => {
  const manifest = await run(['-M']);
  expect(JSON.parse(manifest.stdout)).toMatchObject({ name: 'textstat' });
  expect(manifest.stdout).not.toContain('timing');
  await expect(run(['--totl', 'one.txt'])).resolves.toMatchObject({
    status: 2,
    stderr: expect.stringContaining('Did you mean "--total"?'),
  });
  expect(JSON.stringify(textstat.inspect())).toContain('"enum":["bytes","words","lines"]');
});
