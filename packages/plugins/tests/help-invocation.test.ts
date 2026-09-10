import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/run.mjs', import.meta.url);
const rejected = new URL('fixtures/build.mjs', import.meta.url);

function run(scenario: string, argv: string[]) {
  return invoke(fixture, [scenario, ...argv]);
}

/**
 * The same invocation with a marks file, so a test reads which plugin middleware modules the
 * invocation evaluated. A module the chain never reached leaves no line.
 */
function loaded(scenario: string, argv: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-plugins-marks-'));
  const marks = join(directory, 'marks.txt');
  try {
    const result = invoke(fixture, [scenario, ...argv], { env: { LOOM_FIXTURE_MARKS: marks } });
    let lines: string[] = [];
    try {
      lines = readFileSync(marks, 'utf8').split('\n').filter(Boolean);
    } catch {
      lines = [];
    }
    return { ...result, marks: lines };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** The page the fixture application prints for its root, written by hand from the page rules. */
const root = [
  'app · A fixture application.',
  '',
  'USAGE',
  '  app [options]',
  '  app <command> [options]',
  '',
  'COMMANDS',
  '  get  Read one value at a path.',
  '',
  'GLOBAL OPTIONS',
  '  -h, --help     Show this help.',
  '  -V, --version  Print the version.',
  '',
  'Run app <command> --help for command details.',
  '',
].join('\n');

/** The page for `run`, which needs a required argument and two required options to be invoked. */
const job = [
  'app run · Run one job.',
  '',
  'USAGE',
  '  app run <source> [target] --out <out> --tag <tag>... --key <key> [options]',
  '',
  'ARGUMENTS',
  '  source  Where to read.',
  '  target  Where to write.',
  '',
  'OPTIONS',
  '  -o, --out <out>    The output path.  (required)',
  '      --tag <tag>    A tag to apply.  (required, repeatable)',
  '      --mode <mode>  How to run.',
  '',
  'GLOBAL OPTIONS',
  '      --key <key>    The key to use.  (required)',
  '  -f, --file <file>  The document to read.',
  '  -h, --help         Show this help.',
  '  -V, --version      Print the version.',
  '',
].join('\n');

test('--help --version prints help and never loads the version middleware module', () => {
  const result = loaded('version', ['--help', '--version']);
  expect(result.marks).toEqual(['loaded:help']);
  expect(result).toMatchObject({ status: 0, stderr: '', stdout: root });
});

test('--version --help prints help too, because installation order decides the takeover', () => {
  expect(run('version', ['--version', '--help'])).toEqual({
    status: 0,
    stderr: '',
    stdout: root,
  });
});

test('--version alone loads the version middleware module and no other', () => {
  const result = loaded('version', ['--version']);
  expect(result.marks).toEqual(['loaded:version']);
  expect(result).toMatchObject({ status: 0, stderr: '', stdout: 'app v1.2.0\n' });
});

test('-h renders while a required argument is missing and a local option is unknown', () => {
  expect(run('usage', ['run', '-h', '--nope'])).toEqual({ status: 0, stderr: '', stdout: job });
});

test('an unknown command still fails in routing, before any middleware runs', () => {
  expect(run('usage', ['nope', '--help'])).toEqual({
    status: 2,
    stderr: 'Invalid input: Unknown command "nope". Use one of: run, pack.\n',
    stdout: '',
  });
});

test('a mixed-scope short group is the pre-scan error rather than help', () => {
  expect(run('cells', ['-ht'])).toEqual({
    status: 2,
    stderr:
      'Invalid input: Short group "-ht" mixes the global option "-h" with "-t", which is not a global option. Supply global options as separate tokens, and local options after their command name.\n',
    stdout: '',
  });
});

test('a details value with a blank line is rejected the way any extension value is', () => {
  expect(invoke(rejected, ['blank-details'])).toEqual({
    status: 1,
    stderr:
      'Invalid declaration: The root Command holds an invalid "@loomcli/plugins/help/command" value: Supply prose whose every line holds a character other than whitespace. Correct the value.\n',
    stdout: '',
  });
});

test('an example command that spans two lines is rejected', () => {
  expect(invoke(rejected, ['example-line'])).toEqual({
    status: 1,
    stderr:
      'Invalid declaration: Command "get" holds an invalid "@loomcli/plugins/help/command" value: Supply one line that holds a character other than whitespace. Correct the value.\n',
    stdout: '',
  });
});

test('a placeholder that holds whitespace is rejected', () => {
  expect(invoke(rejected, ['placeholder-whitespace'])).toEqual({
    status: 1,
    stderr:
      'Invalid declaration: Global option "file" holds an invalid "@loomcli/plugins/help/input" value: Supply one word with no whitespace. Correct the value.\n',
    stdout: '',
  });
});
