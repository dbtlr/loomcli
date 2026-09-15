import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function incomplete(scenario: string, env: Record<string, string> = {}) {
  return invoke(new URL('fixtures/incomplete.mjs', import.meta.url), [scenario], { env });
}

/** The incomplete-result line, which names the Command and both counts. */
function line(subject: string, yielded: number, written: number) {
  return `Output is incomplete: ${subject} stopped after ${String(yielded)} rows, ${String(written)} written.\n`;
}

/** The sequence a row view leaves behind when the source failed after its first row. */
const partial = 'PATHS\n0: one.txt\n';

test('a source that throws under an awaited call reports its own code and diagnostic', () => {
  expect(incomplete('source-awaited')).toEqual({
    status: 2,
    stderr: `${line('Command "count"', 1, 1)}Invalid input: The source failed.\n`,
    stdout: `${partial}resolved:2\n`,
  });
});

test('the same failure under an unawaited call is a deferred fault that returns 1', () => {
  expect(incomplete('source-deferred')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 1, 1)}Invalid input: The source failed.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('the line names the root Command where the root action emitted the result', () => {
  expect(incomplete('root')).toEqual({
    status: 1,
    stderr: `${line('the root Command', 1, 1)}The source failed.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('the line prints for zero rows too, so an empty result and a failed one differ', () => {
  expect(incomplete('zero-rows')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}The source failed.\n`,
    stdout: 'PATHS\nresolved:1\n',
  });
});

test('a row view that throws mid-sequence leaves the rows before it written', () => {
  expect(incomplete('view-row')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 2, 1)}Internal error: Cannot render the row.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('an awaited call that lets a thrown failure class propagate keeps that class code', () => {
  expect(incomplete('view-row-class')).toEqual({
    status: 2,
    stderr: `${line('Command "count"', 2, 1)}Invalid input: The view refused.\n`,
    stdout: `${partial}resolved:2\n`,
  });
});

test('a whole view that throws after the source ended writes nothing of the sequence', () => {
  expect(incomplete('whole-view')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 2, 0)}Internal error: Cannot render the table.\n`,
    stdout: 'resolved:1\n',
  });
});

test('a whole view that returns a non-string is the same fault with a stated reason', () => {
  expect(incomplete('whole-non-string')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 2, 0)}Internal error: The view returned number instead of a string.\n`,
    stdout: 'resolved:1\n',
  });
});

test('a source that throws under a whole view queues nothing on the destination', () => {
  expect(incomplete('whole-source')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 1, 0)}The source failed.\n`,
    stdout: 'resolved:1\n',
  });
});

test('a failed write stops the sequence and counts the rows it had written', () => {
  expect(incomplete('write-fails')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 2, 1)}Internal error: Could not write invocation output.\n`,
    stdout: `${JSON.stringify(['PATHS\n', '0: one.txt\n'])}\nresolved:1\n`,
  });
});

test('a stderr that has failed already takes the line through the plain fallback and no further', () => {
  /**
   * The destination records every text it refused, so the capture reads what core tried to write:
   * the action's own print, then the line once, then the one fallback sentence that ends reporting.
   */
  const attempts = [
    'first\n',
    line('Command "count"', 1, 1),
    'Internal error: Could not write invocation output.\n',
  ];
  expect(incomplete('stderr-failed')).toEqual({
    status: 1,
    stderr: '',
    stdout: `${partial}${JSON.stringify(attempts)}\nresolved:1\n`,
  });
});

test('an action that fails stops its pending sequence rather than draining it', () => {
  /**
   * The source records each request, so `requests:0` proves core asked it for nothing once the
   * action failed: the head stands, no row and no tail follow, and the action stays primary.
   */
  expect(incomplete('action-fails')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}The action failed.\n`,
    stdout: 'PATHS\nrequests:0\nresolved:1\n',
  });
});

test('the same stop reaches a sequence the action issued through out.render', () => {
  expect(incomplete('action-fails-render')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}The action failed.\n`,
    stdout: 'PATHS\nrequests:0\nresolved:1\n',
  });
});

test('a cancelled run whose source then returns writes the line alone', () => {
  expect(incomplete('cancelled-returns')).toEqual({
    status: 130,
    stderr: line('Command "count"', 1, 1),
    stdout: `${partial}resolved:130\n`,
  });
});

test('a cancellation echo the source throws is silent and keeps the signal code', () => {
  expect(incomplete('cancelled-echo')).toEqual({
    status: 130,
    stderr: line('Command "count"', 1, 1),
    stdout: `${partial}resolved:130\n`,
  });
});

test('the same echo under a call the action never awaited is silent too', () => {
  expect(incomplete('cancelled-echo-unawaited')).toEqual({
    status: 130,
    stderr: line('Command "count"', 1, 1),
    stdout: `${partial}resolved:130\n`,
  });
});

test('any other failure after cancellation is reported and the code stays the signal', () => {
  expect(incomplete('cancelled-fault')).toEqual({
    status: 130,
    stderr: `${line('Command "count"', 1, 1)}The source failed after the signal.\n`,
    stdout: `${partial}resolved:130\n`,
  });
});

test('a cancelled whole view writes the line with no row written', () => {
  expect(incomplete('whole-cancelled')).toEqual({
    status: 130,
    stderr: line('Command "count"', 1, 0),
    stdout: 'resolved:130\n',
  });
});

test('an override of incompleteResult that returns the empty string silences the line', () => {
  expect(incomplete('silenced')).toEqual({
    status: 1,
    stderr: 'The source failed.\n',
    stdout: `${partial}resolved:1\n`,
  });
});

test('an override that throws is reported as a view fault where nothing else is primary', () => {
  expect(incomplete('line-broken-alone')).toEqual({
    status: 130,
    stderr: 'Internal error: Rendering output failed: Cannot render the line.\n',
    stdout: `${partial}resolved:130\n`,
  });
});

test('a source failure the action rethrew wrapped is reported once', () => {
  expect(incomplete('wrapped')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 1, 1)}Internal error: The action could not finish.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('a failure raised after the result resolved is ordinary and the result stands', () => {
  expect(incomplete('after-resolved')).toEqual({
    status: 1,
    stderr: 'The action failed.\n',
    stdout: 'PATHS\n0: one.txt\n1: two words.txt\nEND\nresolved:1\n',
  });
});

test('a cancelled row view stops asking an endless source and writes no row after the stop', () => {
  expect(incomplete('cancel-row')).toEqual({
    status: 130,
    stderr: line('Command "count"', 2, 1),
    stdout: `${partial}resolved:130\n`,
  });
});

test('a cancelled whole view stops collecting rather than buffering an endless source', () => {
  expect(incomplete('cancel-whole')).toEqual({
    status: 130,
    stderr: line('Command "count"', 2, 0),
    stdout: 'resolved:130\n',
  });
});

test('an action that fails after the source ended leaves the closing piece unwritten', () => {
  expect(incomplete('tail-after-action-fails')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}The action failed.\n`,
    stdout: 'PATHS\nresolved:1\n',
  });
});

test('an iterator result whose done getter throws is the source failure it raised', () => {
  expect(incomplete('done-throws')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}The source failed.\n`,
    stdout: 'PATHS\nresolved:1\n',
  });
});

test('a cleanup that never settles does not hold the stopped run open', () => {
  expect(incomplete('cleanup-hangs', { NODE_OPTIONS: '--unhandled-rejections=strict' })).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}The action failed.\n`,
    stdout: 'PATHS\nresolved:1\n',
  });
});

test('a source that throws undefined is reported once, like any other thrown value', () => {
  expect(incomplete('undefined-throw')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 1, 1)}Internal error: An unknown error occurred.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('a result that iterates neither way is a source fault naming the Command', () => {
  expect(incomplete('not-iterable')).toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}Internal error: The result of Command "count" is not iterable.\n`,
    stdout: 'resolved:1\n',
  });
});
