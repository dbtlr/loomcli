/*
 * Acceptance plan for results (docs/core/results.md).
 *
 * Results are proven when examples/textstat declares its table as a result with one whole view
 * under the key `table` and prints the table bytes that packages/plugins/tests/table.test.ts pins,
 * with its `--timing` line still on stderr. They are also proven when a hidden jsonkit Command
 * declares `rows<Entry>` over the document's paths with a row view as its default and a whole view
 * under a second key, writes each row as an async generator yields it, and leaves a partial list
 * and the incomplete line behind when the generator throws. Each case runs under Node and Bun. The
 * cases:
 *
 * - Rendering. Both shapes of `out.render` with a row view under a synchronous and an asynchronous
 *   iterable. `out.results` under each declaration with an array, a generator, and an async
 *   generator.
 * - Back-pressure. Observed through a destination that delays its write callback and a source that
 *   records each request, so no second request precedes the first callback. A later `print` to the
 *   same destination lands after an unawaited sequence's last piece under a row view and under a
 *   whole view. An invocation stays open while an unawaited sequence waits on a slow source and
 *   completes after it.
 * - Destinations. `print` and `render` reach stderr with stderr's capabilities on a result Command
 *   and stdout on a plain one. A middleware's `print` keeps stdout on a result Command.
 * - Result errors. Each `ResultError` kind with its exit code, its prefix, and an `undefined`
 *   cause. An `InternalError` override reaching a `ResultError`. A cancelled run with an unemitted
 *   result returns the signal's code and no missing-result diagnostic.
 * - Early stops. Each early stop under a row view and under a whole view, with the incomplete line
 *   carrying both counts before the report. A whole view that throws after a finite source ended. A
 *   cancelled source that returns leaves the line alone. An override of `incompleteResult` silences
 *   it, and one that throws leaves the primary report intact.
 * - Empty sequences. An empty sequence under each view shape.
 * - `views()`. It replaces a key in place, appends a key, moves the default, and keeps a moved
 *   default through a later call. `inspect()` publishes the fact.
 * - Build rules. Each build rule the reference lists.
 * - Positive type checks. A declared row view in a plugin's `views` list, and a library's neutral
 *   annotation and `command()` attachment of a declaration with a result.
 * - Negative type checks. An iterable that is not the declared value passed under `result`, a value
 *   passed under `rows`, `out.results` on a Command with no result and on a middleware's `out`, a
 *   column that names a missing field through the declaration and through `out.render`, a value
 *   with both `render` and `row` in a declaration and in `views()`, a row view under `result` in a
 *   declaration and in `views()`, `result()` or `rows()` called after `action()`, and `views()` on
 *   a declaration with no result.
 */

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function results(scenario: string, env: Record<string, string> = {}) {
  return invoke(new URL('fixtures/results.mjs', import.meta.url), [scenario], { env });
}

/** The whole sequence the row view writes, which every complete rows scenario produces. */
const sequence = 'PATHS\n0: one.txt\n1: two words.txt\nEND\n';

/** What a distributed build writes for a results-lane fault, which is a defect. */
const generic = 'results: Something went wrong.\n';

/** A development build states the fault's own sentence in its Developer Diagnostic. */
function expectStated(scenario: string, sentence: string) {
  expect(results(scenario, { FIXTURE_BUILD: 'development' }).stderr).toContain(`\n\n${sentence}\n`);
}

test('a value result renders its default view and writes the text to stdout', () => {
  expect(results('value')).toEqual({ status: 0, stderr: '', stdout: 'total 3\nresolved:0\n' });
});

test.each(['array', 'sync', 'async'])(
  'a rows result under a row view writes every row of a %s source',
  (scenario) => {
    expect(results(scenario)).toEqual({ status: 0, stderr: '', stdout: `${sequence}resolved:0\n` });
  },
);

test('a whole view collects every row and renders once at the end of the source', () => {
  expect(results('whole')).toEqual({ status: 0, stderr: '', stdout: '2 rows\nresolved:0\n' });
});

test('an empty sequence still writes head and tail under a row view', () => {
  expect(results('empty-row')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'PATHS\nEND\nresolved:0\n',
  });
});

test('a declared row view tail receives the number of rows written through out.results', () => {
  expect(results('counted-tail')).toEqual({
    status: 0,
    stderr: '',
    stdout: '0: one.txt\n1: two words.txt\nCOUNT:2\nresolved:0\n',
  });
});

test('a string source iterates one character per row, as every synchronous iterable does', () => {
  expect(results('string-source')).toEqual({
    status: 0,
    stderr: '',
    stdout: '0:a\n1:b\nresolved:0\n',
  });
});

test('a source that carries an undefined async iterator falls to its synchronous one', () => {
  expect(results('half-async')).toEqual({
    status: 0,
    stderr: '',
    stdout: `${sequence}resolved:0\n`,
  });
});

test.each(['declared-value', 'declared-rows'])(
  "the Application's override list never reaches a %s result's views",
  (scenario) => {
    expect(results(scenario)).toEqual({ status: 0, stderr: '', stdout: 'original\nresolved:0\n' });
  },
);

test('an empty sequence renders a whole view over an empty array', () => {
  expect(results('empty-whole')).toEqual({ status: 0, stderr: '', stdout: '0 rows\nresolved:0\n' });
});

test('the emitted result is the ordering anchor for what the action writes next', () => {
  // Both streams reach one destination, so the test reads the order the two calls wrote in.
  const written = ['PATHS\n', '0: one.txt\n', '1: two words.txt\n', 'END\n', 'i done\n'];
  expect(results('order')).toEqual({
    status: 0,
    stderr: '',
    stdout: `${JSON.stringify(written)}\nresolved:0\n`,
  });
});

test('a result the action never awaited is written and accounted for before completion', () => {
  expect(results('unawaited')).toEqual({
    status: 0,
    stderr: '',
    stdout: `${sequence}resolved:0\n`,
  });
});

test('on a result Command the action writes everything but the result to stderr', () => {
  /**
   * Stdout is no terminal in this run and stderr is, so the styled line proves the view context
   * moved with the destination: the same call writes color on stderr and none on stdout.
   */
  expect(results('redirect')).toEqual({
    status: 0,
    stderr: `[31mplain[39m\nrendered\n${sequence}laned\n`,
    stdout: 'total 1\nresolved:0\n',
  });
});

test('on a Command with no result every method keeps its own destination', () => {
  expect(results('plain')).toEqual({
    status: 0,
    stderr: '',
    stdout: `plain\nrendered\n${sequence}laned\nresolved:0\n`,
  });
});

test("a middleware's print keeps stdout on a result Command, before and after next()", () => {
  expect(results('middleware-print')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'before\ntotal 1\nafter\nresolved:0\n',
  });
});

test('an action that returns without emitting fails with the missing diagnostic', () => {
  expect(results('missing')).toEqual({
    status: 1,
    stderr: generic,
    stdout: 'resolved:1\n',
  });
  expectStated(
    'missing',
    'Command "count" declares a result and its action returned without emitting one. Call out.results() once.',
  );
});

test('the same fault at the root names the root Command', () => {
  expect(results('missing-root')).toEqual({
    status: 1,
    stderr: generic,
    stdout: 'resolved:1\n',
  });
  expectStated(
    'missing-root',
    'The root Command declares a result and its action returned without emitting one. Call out.results() once.',
  );
});

test('a second emission no code awaits has no catcher and fails the run', () => {
  expect(results('repeated-unawaited')).toEqual({
    status: 1,
    stderr: generic,
    stdout: 'total 1\nresolved:1\n',
  });
  expectStated(
    'repeated-unawaited',
    'Command "count" emitted its result twice. Call out.results() once.',
  );
});

test('an action that catches the rejection of a second emission decides the outcome', () => {
  expect(results('repeated-caught')).toEqual({
    status: 0,
    stderr: 'caught\n',
    stdout: 'total 1\nresolved:0\n',
  });
});

test('the same fault the action let propagate is reported once', () => {
  expect(results('repeated-awaited')).toEqual({
    status: 1,
    stderr: generic,
    stdout: 'total 1\nresolved:1\n',
  });
  expectStated(
    'repeated-awaited',
    'Command "count" emitted its result twice. Call out.results() once.',
  );
});

test('a failure raised before the call is that failure and no missing-result fault', () => {
  expect(results('failure-first')).toEqual({
    status: 1,
    stderr: 'The failure came first.\n',
    stdout: 'resolved:1\n',
  });
});

test('a middleware that never dispatches raises no missing-result fault', () => {
  expect(results('middleware-no-dispatch')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'resolved:0\n',
  });
});

test('an override of InternalError brands a ResultError', () => {
  expect(results('internal-override')).toEqual({
    status: 1,
    stderr:
      'branded:Command "count" declares a result and its action returned without emitting one. Call out.results() once.\n',
    stdout: 'resolved:1\n',
  });
});

test('an override keyed by ResultError reaches it with its path, its kind, and no cause', () => {
  expect(results('result-override')).toEqual({
    status: 1,
    stderr: 'result:missing:count:undefined\n',
    stdout: 'resolved:1\n',
  });
});

test('that override reaches the results lane alone, and every other internal error is branded', () => {
  expect(results('override-scope')).toEqual({
    status: 1,
    stderr: 'branded:the action failed\n',
    stdout: 'resolved:1\n',
  });
});
