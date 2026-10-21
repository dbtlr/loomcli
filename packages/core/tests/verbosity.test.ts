/*
 * Acceptance plan for verbosity (docs/core/verbosity.md#verbosity).
 *
 * The verbosity is proven when public APIs alone produce these results under Node and Bun, through
 * a fixture Application that marks its own options and through jsonkit with the verbose plugin:
 *
 * - The lanes. A fixture action that writes every lane prints `info`, `success`, `warn`, and
 *   `error` and no debug or trace line with no spelling, adds the debug line under `-v`, adds the
 *   trace line under `-vv`, and prints the same under `-vvv` as under `-vv`. Under `-q` and `-qq`
 *   it prints `warn` and `error` alone, and `print`, `render`, `draw`, a result, the
 *   incomplete-result line of a sequence that stops early, and a failure print at every verbosity.
 *   `-v -q` prints what no spelling prints, and `-vv -q` what `-v` prints.
 * - Every form. `-vq`, `-qv`, `--verbose -v`, a short group with a Command's own letter, a letter
 *   an `onCommandAttach` hook declared on the routed Command beside `-v` in one group, an alias, a
 *   `shortOnly` marked option's letter, occurrences on both sides of the Command name, and a
 *   spelling after the bare `--`, which counts nothing, each settle what the ordinary parse reads.
 * - Destinations. Debug and trace lines reach stderr with stdout piped and on a Command that
 *   declares a result, whose stdout holds the result alone. Piped, with neither color variable set,
 *   each line is its gutter and its message, unwrapped and with no escape. On a capable terminal
 *   the gutters and styles match the lines the reference shows, a long message wraps at the columns
 *   right of its gutter with every continuation line under the message, and `NO_COLOR=1` keeps
 *   `faint` on a trace line.
 * - Not logging. Under `-vv`, a fixture plugin's `onLog` hook receives no event for an `out.debug`
 *   or `out.trace` call, and the logging plugin's console destination writes no record for one.
 * - Hidden calls. A hidden `out.debug(42)` from JavaScript rejects as `out.info(42)` does, and a
 *   hidden call calls no override of its lane view.
 * - Before the chain. A configuration source's `out.debug` line prints under `-v` and not without
 *   it, and a dotenv warning prints under `-q`. A fixture middleware's `out.debug` line prints
 *   under `-v` and not without it, and its `out.info` line prints without a spelling and not under
 *   `-q`. A declaration error from graph build prints under `-q`, and `jsonkit -q nope` prints its
 *   unknown-command failure.
 * - By name. `invoke` with `verbose: 2` captures the debug and trace lines in `messages`, a call
 *   without it captures neither inside a parent run started with `-vv`, and `verbose: 1.5` fails
 *   with its counted-option issue and exit 2. An MCP tool call that names `verbose` is rejected,
 *   and a tool call writes no debug line.
 * - No mark. An Application with neither mark writes no debug or trace line under any argv, and
 *   every other byte is unchanged.
 * - The options. `options.verbose` reads `3` under `-vvv` and `options.quiet` reads `2` under
 *   `-qq`.
 * - Declarations. Each rejected declaration the reference lists, for the verbose mark and the quiet
 *   mark, throws under its rule from the moment the reference names, and the negative type checks
 *   reject the rules the types state.
 */

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

test("an unknown command's failure prints under -q", () => {
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

test("the logging plugin's console destination writes no record for a debug or trace call", () => {
  // The action logs one event of its own, so the one record shows the destination writes.
  const lines = fetchit('console', 'pipe', ['-vv', 'get', 'u']).stderr.split('\n');
  const records = lines.filter((line) => line.startsWith('{'));
  expect(records).toHaveLength(1);
  expect(records[0]).toContain('"logged"');
  expect(lines.filter((line) => !line.startsWith('{')).join('\n')).toBe(shown.trace);
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
  // The show action writes no warning of its own, so the line can only come from dotenv.
  expect(fetchit('dotenv', 'pipe', ['-q', 'show']).stderr).toBe(
    '⚠ Skipped FETCHIT_TOKEN on line 1 of .env: the line is not a valid assignment. Correct the line, or remove it.\n',
  );
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
