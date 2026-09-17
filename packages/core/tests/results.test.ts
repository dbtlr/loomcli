import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function results(scenario: string) {
  return invoke(new URL('fixtures/results.mjs', import.meta.url), [scenario]);
}

/** The whole sequence the row view writes, which every complete rows scenario produces. */
const sequence = 'PATHS\n0: one.txt\n1: two words.txt\nEND\n';

/** The diagnostic one results-lane fault reports, under the prefix its class carries. */
function internal(sentence: string) {
  return `Internal error: ${sentence}\n`;
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
    stderr: internal(
      'Command "count" declares a result and its action returned without emitting one. Call out.results() once.',
    ),
    stdout: 'resolved:1\n',
  });
});

test('the same fault at the root names the root Command', () => {
  expect(results('missing-root')).toEqual({
    status: 1,
    stderr: internal(
      'The root Command declares a result and its action returned without emitting one. Call out.results() once.',
    ),
    stdout: 'resolved:1\n',
  });
});

test('a second emission rejects and turns a would-be 0 into 1', () => {
  expect(results('repeated')).toEqual({
    status: 1,
    stderr: internal('Command "count" emitted its result twice. Call out.results() once.'),
    stdout: 'total 1\nresolved:1\n',
  });
});

test('the same fault the action let propagate is reported once', () => {
  expect(results('repeated-awaited')).toEqual({
    status: 1,
    stderr: internal('Command "count" emitted its result twice. Call out.results() once.'),
    stdout: 'total 1\nresolved:1\n',
  });
});

test('out.results on a Command that declares no result is the undeclared fault', () => {
  expect(results('undeclared')).toEqual({
    status: 1,
    stderr: internal(
      'Command "plain" declares no result. Declare one with result() or rows() before action().',
    ),
    stdout: 'resolved:1\n',
  });
});

test('out.results from a middleware is the middleware fault whatever the action did', () => {
  expect(results('middleware-results')).toEqual({
    status: 1,
    stderr: internal(
      'A middleware called out.results() on Command "count". Only the action emits a result.',
    ),
    stdout: 'before\ntotal 1\nafter\nresolved:1\n',
  });
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
