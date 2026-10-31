import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

async function incomplete(scenario: string, env: Record<string, string> = {}) {
  return await invokeFixture(new URL('fixtures/incomplete.mjs', import.meta.url), [scenario], {
    env,
  });
}

/** The incomplete-result line, which names the Command and both counts. */
function line(subject: string, yielded: number, written: number) {
  return `Output is incomplete: ${subject} stopped after ${String(yielded)} rows, ${String(written)} written.\n`;
}

/** The sequence a row view leaves behind when the source failed after its first row. */
const partial = 'PATHS\n0: one.txt\n';

test('a source that throws under an awaited call reports its own code and diagnostic', async () => {
  await expect(incomplete('source-awaited')).resolves.toEqual({
    status: 2,
    stderr: `${line('Command "count"', 1, 1)}incomplete: The source failed.\n`,
    stdout: `${partial}resolved:2\n`,
  });
});

test('the same failure under an unawaited call reports after the action with its own code', async () => {
  await expect(incomplete('source-deferred')).resolves.toEqual({
    status: 2,
    stderr: `${line('Command "count"', 1, 1)}incomplete: The source failed.\n`,
    stdout: `${partial}resolved:2\n`,
  });
});

test('the line names the root Command where the root action emitted the result', async () => {
  await expect(incomplete('root')).resolves.toEqual({
    status: 1,
    stderr: `${line('the root Command', 1, 1)}The source failed.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('the line prints for zero rows too, so an empty result and a failed one differ', async () => {
  await expect(incomplete('zero-rows')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}The source failed.\n`,
    stdout: 'PATHS\nresolved:1\n',
  });
});

test('a row view that throws mid-sequence leaves the rows before it written', async () => {
  await expect(incomplete('view-row')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 2, 1)}incomplete: Something went wrong.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('an awaited call that lets a thrown failure class propagate keeps that class code', async () => {
  await expect(incomplete('view-row-class')).resolves.toEqual({
    status: 2,
    stderr: `${line('Command "count"', 2, 1)}incomplete: The view refused.\n`,
    stdout: `${partial}resolved:2\n`,
  });
});

test('a whole view that throws after the source ended writes nothing of the sequence', async () => {
  await expect(incomplete('whole-view')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 2, 0)}incomplete: Something went wrong.\n`,
    stdout: 'resolved:1\n',
  });
});

test('a source that throws under a whole view queues nothing on the destination', async () => {
  await expect(incomplete('whole-source')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 1, 0)}The source failed.\n`,
    stdout: 'resolved:1\n',
  });
});

test('a failed write stops the sequence and counts the rows it had written', async () => {
  await expect(incomplete('write-fails')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 2, 1)}incomplete: Something went wrong.\n`,
    stdout: `${JSON.stringify(['PATHS\n', '0: one.txt\n'])}\nresolved:1\n`,
  });
});

test('a stderr that has failed already takes the line through the plain fallback and no further', async () => {
  /**
   * The destination records every text it refused, so the capture reads what core tried to write:
   * the action's own print, then the line once, then the one fallback sentence that ends reporting.
   */
  const attempts = [
    'first\n',
    line('Command "count"', 1, 1),
    'incomplete: Something went wrong.\n',
  ];
  await expect(incomplete('stderr-failed')).resolves.toEqual({
    status: 1,
    stderr: '',
    stdout: `${partial}${JSON.stringify(attempts)}\nresolved:1\n`,
  });
});

test('an action that fails stops its pending sequence rather than draining it', async () => {
  /**
   * The source records each request, so `requests:0` proves core asked it for nothing once the
   * action failed: the head stands, no row and no tail follow, and the action stays primary.
   */
  await expect(incomplete('action-fails')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}The action failed.\n`,
    stdout: 'PATHS\nrequests:0\nresolved:1\n',
  });
});

test('the same stop reaches a sequence the action issued through out.render', async () => {
  await expect(incomplete('action-fails-render')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}The action failed.\n`,
    stdout: 'PATHS\nrequests:0\nresolved:1\n',
  });
});

test('a cancelled run whose source then returns writes the line alone', async () => {
  await expect(incomplete('cancelled-returns')).resolves.toEqual({
    status: 130,
    stderr: line('Command "count"', 1, 1),
    stdout: `${partial}resolved:130\n`,
  });
});

test('a cancellation echo the source throws is silent and keeps the signal code', async () => {
  await expect(incomplete('cancelled-echo')).resolves.toEqual({
    status: 130,
    stderr: line('Command "count"', 1, 1),
    stdout: `${partial}resolved:130\n`,
  });
});

test('the same echo under a call the action never awaited is silent too', async () => {
  await expect(incomplete('cancelled-echo-unawaited')).resolves.toEqual({
    status: 130,
    stderr: line('Command "count"', 1, 1),
    stdout: `${partial}resolved:130\n`,
  });
});

test('any other failure after cancellation is reported and the code stays the signal', async () => {
  await expect(incomplete('cancelled-fault')).resolves.toEqual({
    status: 130,
    stderr: `${line('Command "count"', 1, 1)}The source failed after the signal.\n`,
    stdout: `${partial}resolved:130\n`,
  });
});

test('a cancelled whole view writes the line with no row written', async () => {
  await expect(incomplete('whole-cancelled')).resolves.toEqual({
    status: 130,
    stderr: line('Command "count"', 1, 0),
    stdout: 'resolved:130\n',
  });
});

test('an override of incompleteResult that returns the empty string silences the line', async () => {
  await expect(incomplete('silenced')).resolves.toEqual({
    status: 1,
    stderr: 'The source failed.\n',
    stdout: `${partial}resolved:1\n`,
  });
});

test('an override that throws is reported as a view fault where nothing else is primary', async () => {
  await expect(incomplete('line-broken-alone')).resolves.toEqual({
    status: 130,
    stderr: 'incomplete: Something went wrong.\n',
    stdout: `${partial}resolved:130\n`,
  });
});

test('a source failure the action rethrew wrapped is reported once', async () => {
  await expect(incomplete('wrapped')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 1, 1)}incomplete: Something went wrong.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('a failure raised after the result resolved is ordinary and the result stands', async () => {
  await expect(incomplete('after-resolved')).resolves.toEqual({
    status: 1,
    stderr: 'The action failed.\n',
    stdout: 'PATHS\n0: one.txt\n1: two words.txt\nEND\nresolved:1\n',
  });
});

test('a cancelled row view stops asking an endless source and writes no row after the stop', async () => {
  await expect(incomplete('cancel-row')).resolves.toEqual({
    status: 130,
    stderr: line('Command "count"', 2, 1),
    stdout: `${partial}resolved:130\n`,
  });
});

test('a cancelled whole view stops collecting rather than buffering an endless source', async () => {
  await expect(incomplete('cancel-whole')).resolves.toEqual({
    status: 130,
    stderr: line('Command "count"', 2, 0),
    stdout: 'resolved:130\n',
  });
});

test('an action that fails after the source ended leaves the closing piece unwritten', async () => {
  await expect(incomplete('tail-after-action-fails')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}The action failed.\n`,
    stdout: 'PATHS\nresolved:1\n',
  });
});

test('an iterator result whose done getter throws is the source failure it raised', async () => {
  await expect(incomplete('done-throws')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}The source failed.\n`,
    stdout: 'PATHS\nresolved:1\n',
  });
});

test('a cleanup that never settles does not hold the stopped run open', async () => {
  // Vitest reports any unhandled rejection from this in-process run.
  await expect(incomplete('cleanup-hangs')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}The action failed.\n`,
    stdout: 'PATHS\nresolved:1\n',
  });
});

test('a source that throws undefined is reported once, like any other thrown value', async () => {
  await expect(incomplete('undefined-throw')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 1, 1)}incomplete: Something went wrong.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('a result that iterates neither way is a source fault naming the Command', async () => {
  await expect(incomplete('not-iterable')).resolves.toEqual({
    status: 1,
    stderr: `${line('Command "count"', 0, 0)}incomplete: Something went wrong.\n`,
    stdout: 'resolved:1\n',
  });
});
