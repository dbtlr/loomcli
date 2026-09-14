import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function rows(scenario: string) {
  return invoke(new URL('fixtures/rows.mjs', import.meta.url), [scenario]);
}

/** The whole sequence the row view writes, which every complete scenario produces. */
const sequence = 'PATHS\n0: one.txt\n1: two words.txt\nEND\n';

/** The sequence a source that fails after its first row leaves behind. */
const partial = 'PATHS\n0: one.txt\n';

/** The incomplete-result line, which names the Command and both counts. */
function incomplete(subject: string, yielded: number, written: number) {
  return `Output is incomplete: ${subject} stopped after ${String(yielded)} rows, ${String(written)} written.\n`;
}

test('a row view writes head, each row, and tail under a synchronous iterable', () => {
  expect(rows('sync')).toEqual({ status: 0, stderr: '', stdout: `${sequence}resolved:0\n` });
});

test('an asynchronous source writes the same sequence as it yields', () => {
  expect(rows('async')).toEqual({ status: 0, stderr: '', stdout: `${sequence}resolved:0\n` });
});

test('an empty sequence still writes head and tail', () => {
  expect(rows('empty')).toEqual({ status: 0, stderr: '', stdout: 'PATHS\nEND\nresolved:0\n' });
});

test('core requests no row until the previous piece has been written', () => {
  /**
   * The destination reports each completed write and the source reports each request, so the two
   * interleave: no second request precedes the first callback, whatever the source could supply.
   */
  const watched = [
    'wrote:PATHS\n',
    'pull:one.txt',
    'wrote:0: one.txt\n',
    'pull:two words.txt',
    'wrote:1: two words.txt\n',
    'pull:end',
    'wrote:END\n',
  ];
  expect(rows('back-pressure')).toEqual({
    status: 0,
    stderr: '',
    stdout: `${JSON.stringify(watched)}\nresolved:0\n`,
  });
});

test('a later print on the same destination writes after an unawaited sequence', () => {
  expect(rows('order')).toEqual({
    status: 0,
    stderr: '',
    stdout: `${sequence}after\nresolved:0\n`,
  });
});

test('a pending sequence keeps the invocation open until its source ends', () => {
  expect(rows('open')).toEqual({ status: 0, stderr: '', stdout: `${sequence}resolved:0\n` });
});

test('a source that throws under an awaited call reports the incomplete line first', () => {
  expect(rows('source-awaited')).toEqual({
    status: 1,
    stderr: `${incomplete('Command "count"', 1, 1)}The source failed.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('the same failure under an unawaited call is a deferred fault that returns 1', () => {
  expect(rows('source-deferred')).toEqual({
    status: 1,
    stderr: `${incomplete('Command "count"', 1, 1)}The source failed.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('the line names the root Command where the root action rendered the sequence', () => {
  expect(rows('root')).toEqual({
    status: 1,
    stderr: `${incomplete('the root Command', 1, 1)}The source failed.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('a row view that throws mid-sequence leaves the rows before it written', () => {
  expect(rows('row-broken')).toEqual({
    status: 1,
    stderr: `${incomplete('Command "count"', 2, 1)}Internal error: Rendering output failed: Cannot render the row.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('a row view that returns a non-string stops the sequence with a stated reason', () => {
  const reason = 'The view returned number instead of a string.';
  expect(rows('row-non-string')).toEqual({
    status: 1,
    stderr: `${incomplete('Command "count"', 1, 0)}Internal error: Rendering output failed: ${reason}\n`,
    stdout: 'PATHS\nresolved:1\n',
  });
});

test('a failed write stops the sequence and counts the rows it had written', () => {
  expect(rows('write-fails')).toEqual({
    status: 1,
    stderr: `${incomplete('Command "count"', 2, 1)}Internal error: Could not write invocation output.\n`,
    stdout: `${JSON.stringify(['PATHS\n', '0: one.txt\n'])}\nresolved:1\n`,
  });
});

test('a cancelled run whose source then returns writes the line alone', () => {
  expect(rows('cancelled')).toEqual({
    status: 130,
    stderr: incomplete('Command "count"', 1, 1),
    stdout: `${partial}resolved:130\n`,
  });
});

test('a view value that carries both shapes is the fault of its own call', () => {
  expect(rows('both-shapes')).toEqual({
    status: 1,
    stderr:
      'Internal error: Rendering output failed: The view carries render and row. Supply one of the two.\n',
    stdout: 'resolved:1\n',
  });
});

test('a view value that carries neither shape is the same fault', () => {
  expect(rows('no-shape')).toEqual({
    status: 1,
    stderr:
      'Internal error: Rendering output failed: The view carries neither render nor row. Supply a view with render or a row view with row.\n',
    stdout: 'resolved:1\n',
  });
});

test('an override of incompleteResult that returns the empty string silences the line', () => {
  expect(rows('silenced')).toEqual({
    status: 1,
    stderr: 'The source failed.\n',
    stdout: `${partial}resolved:1\n`,
  });
});

test('an override that throws writes nothing for the line and leaves the report intact', () => {
  expect(rows('line-broken')).toEqual({
    status: 1,
    stderr: 'The source failed.\n',
    stdout: `${partial}resolved:1\n`,
  });
});
