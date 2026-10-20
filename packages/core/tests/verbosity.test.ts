import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The fetchit application, which marks its own `-v, --verbose` and `-q, --quiet`. */
const fixture = new URL('fixtures/verbosity.mjs', import.meta.url);

/** A shell environment with no color variable and a terminal type that supports color. */
const plain = { COLORTERM: undefined, FORCE_COLOR: undefined, NO_COLOR: undefined, TERM: 'xterm' };

/** The working directory holding a malformed `.env` line. */
const directory = realpathSync(mkdtempSync(join(tmpdir(), 'loom-verbosity-')));
writeFileSync(join(directory, '.env'), 'FETCHIT_TOKEN\n');

afterAll(() => {
  rmSync(directory, { force: true, recursive: true });
});

/** One run of the fixture: the variant, the terminal, the command line, and any variables. */
function fetchit(
  variant: string,
  terminal: 'tty' | 'pipe' | 'invoke',
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
) {
  return invoke(fixture, [variant, terminal, ...argv], {
    env: { ...plain, PROBE_CWD: directory, ...env },
  });
}

/** What the `get` action writes on stderr at each verbosity, piped, with its drawn view last. */
const shown = {
  debug: '› debug\nℹ info\n✔ success\n⚠ warn\n✘ error\n[draw]',
  default: 'ℹ info\n✔ success\n⚠ warn\n✘ error\n[draw]',
  quiet: '⚠ warn\n✘ error\n[draw]',
  trace: '  ┆ trace\n› debug\nℹ info\n✔ success\n⚠ warn\n✘ error\n[draw]',
};

test.each([
  [[], shown.default],
  [['-v'], shown.debug],
  [['-vv'], shown.trace],
  [['-vvv'], shown.trace],
  [['-q'], shown.quiet],
  [['-qq'], shown.quiet],
  [['-v', '-q'], shown.default],
  [['-vv', '-q'], shown.debug],
])('%j writes the lanes its verbosity shows', (flags, stderr) => {
  const result = fetchit('own', 'pipe', [...flags, 'get', 'u']);
  expect(result.stderr).toBe(stderr);
  expect(result.status).toBe(0);
});

test('print and render write at every verbosity', () => {
  const result = fetchit('own', 'pipe', ['-q', 'get', 'u']);
  expect(result.stdout).toBe('print\nrender\n{"quiet":1,"verbose":0}\n');
});

test.each([
  ['a group of both letters', ['-vq', 'get', 'u'], shown.default],
  ['a group in the other order', ['-qv', 'get', 'u'], shown.default],
  ['the long spelling beside the short', ['--verbose', '-v', 'get', 'u'], shown.trace],
  ['an alias', ['--loud', 'get', 'u'], shown.debug],
  ["a group with the Command's own value letter", ['get', '-vF', 'name', 'u'], shown.debug],
  ['occurrences on both sides of the Command name', ['-v', 'get', 'u', '-v'], shown.trace],
  ['a spelling after the bare --', ['get', 'u', '--', '-v'], shown.default],
])('%s settles what the ordinary parse reads', (_case, argv, stderr) => {
  expect(fetchit('own', 'pipe', argv).stderr).toBe(stderr);
});

test('a letter an onCommandAttach hook declared reads beside -v in one group', () => {
  expect(fetchit('hooked', 'pipe', ['get', '-vx', 'u']).stderr).toBe(shown.debug);
});

test("a short-only verbose option's letter raises the verbosity", () => {
  expect(fetchit('short-only', 'pipe', ['-vv', 'get', 'u']).stderr).toBe(shown.trace);
});

test('an occurrence the parse faults counts nothing', () => {
  const result = fetchit('own', 'pipe', ['--verbose=2', 'get', 'u']);
  expect(result.status).toBe(2);
  expect(result.stderr).not.toContain('›');
  expect(result.stderr).toContain('"--verbose"');
});

test('an unknown command settles verbosity 0 and its failure prints under -q', () => {
  const result = fetchit('own', 'pipe', ['-q', 'nope']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('"nope"');
});

test('debug and trace reach stderr on a Command that declares a result, whose stdout holds it alone', () => {
  const result = fetchit('own', 'pipe', ['-vv', 'show']);
  expect(result).toEqual({ status: 0, stderr: '› debug\n  ┆ trace\n', stdout: 'record\n' });
});

test('the incomplete-result line and the failure print under -q', () => {
  const result = fetchit('own', 'pipe', ['-q', 'list']);
  expect(result.stdout).toBe('"first"\n');
  expect(result.stderr).toContain('Output is incomplete:');
  expect(result.stderr).toContain('Something went wrong.');
  expect(result.status).toBe(1);
});

test('a failure prints under -q', () => {
  const result = fetchit('own', 'pipe', ['-q', 'fail']);
  expect(result.stderr).toContain('It failed.');
  expect(result.status).toBe(1);
});

/** One SGR sequence. */
const escape = String.fromCodePoint(27);

test('on a terminal a debug line is dim and a trace line nests deeper and adds faint', () => {
  const result = fetchit('themed', 'tty', ['-vv', 'show']);
  expect(result.stderr).toBe(
    `${escape}[90m›${escape}[39m ${escape}[90mdebug${escape}[39m\n  ${escape}[90;2m┆${escape}[39;22m ${escape}[90;2mtrace${escape}[39;22m\n`,
  );
});

test('under NO_COLOR a trace line keeps faint and a debug line drops its color', () => {
  const result = fetchit('themed', 'tty', ['-vv', 'show'], { NO_COLOR: '1' });
  expect(result.stderr).toBe(
    `› debug\n  ${escape}[2m┆${escape}[22m ${escape}[2mtrace${escape}[22m\n`,
  );
});

test('a long message wraps at the columns right of its gutter, continuations under the message', () => {
  const result = fetchit('long', 'tty', ['-vv', 'get', 'u'], { NO_COLOR: '1', TERM: 'dumb' });
  expect(result.stderr.split('\n')).toEqual([
    '› one two three four five six seven',
    '  eight nine ten',
    '  ┆ one two three four five six seven',
    '    eight nine ten',
    '',
  ]);
});

test('a debug or trace call creates no log event', () => {
  expect(fetchit('logged', 'pipe', ['-vv', 'get', 'u']).stdout).toContain('heard []\n');
});

test('a hidden out.debug(42) rejects as out.info(42) does', () => {
  const hidden = fetchit('hidden', 'pipe', ['get', 'u']);
  const shownCall = fetchit('info', 'pipe', ['get', 'u']);
  expect(hidden.status).toBe(1);
  expect(hidden).toEqual(shownCall);
});

test('a hidden call calls no override of its lane view', () => {
  expect(fetchit('override', 'pipe', ['get', 'u']).status).toBe(0);
  expect(fetchit('override', 'pipe', ['-v', 'get', 'u']).status).toBe(1);
});

test("a configuration source's debug line prints under -v and not without it", () => {
  expect(fetchit('config', 'pipe', ['-v', 'get', 'u']).stderr).toContain('› Read .fetchit.json.\n');
  expect(fetchit('config', 'pipe', ['get', 'u']).stderr).not.toContain('Read .fetchit.json.');
});

test('a dotenv warning prints under -q', () => {
  expect(fetchit('dotenv', 'pipe', ['-q', 'get', 'u']).stderr).toContain('⚠ ');
});

test("a middleware's out follows the run's verbosity", () => {
  expect(fetchit('middleware', 'pipe', ['-v', 'get', 'u']).stderr).toContain(
    '› middleware debug\n',
  );
  const plainRun = fetchit('middleware', 'pipe', ['get', 'u']).stderr;
  expect(plainRun).toContain('ℹ middleware info\n');
  expect(plainRun).not.toContain('middleware debug');
  expect(fetchit('middleware', 'pipe', ['-q', 'get', 'u']).stderr).not.toContain('middleware info');
});

test('a declaration error from graph build prints under -q', () => {
  const result = fetchit('graph', 'pipe', ['-q', 'get', 'u']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('The judge rejects the graph.');
});

/** The outcome an invocation by name with these option values captures. */
function byName(values: Record<string, unknown>): unknown {
  const result = fetchit('own', 'invoke', [JSON.stringify(values)]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test('invoke with verbose: 2 captures the debug and trace lines in messages', () => {
  expect(byName({ verbose: 2 })).toMatchObject({
    messages: '  ┆ trace\n› debug\nℹ info\n✔ success\n⚠ warn\n✘ error\n[draw]',
    status: 'completed',
  });
});

test('a call inherits nothing from a parent run started with -vv', () => {
  const result = fetchit('own', 'pipe', ['-vv', 'nested']);
  expect(result.stdout).toBe(`${JSON.stringify(shown.default)}\n`);
});

test('verbose: 1.5 fails with its counted-option issue and exit 2', () => {
  expect(byName({ verbose: 1.5 })).toMatchObject({ exitCode: 2, status: 'failed' });
});

test.each([[['-vv']], [['-q']]])('an Application with neither mark ignores %j', (flags) => {
  expect(fetchit('unmarked', 'pipe', [...flags, 'get', 'u']).stderr).toBe(shown.default);
});

test('options.verbose and options.quiet read the counts the operator typed', () => {
  expect(fetchit('own', 'pipe', ['-vvv', '-qq', 'get', 'u']).stdout).toContain(
    '{"quiet":2,"verbose":3}\n',
  );
});
