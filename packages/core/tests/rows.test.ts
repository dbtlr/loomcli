import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

async function rows(scenario: string) {
  return await invokeFixture(new URL('fixtures/rows.mjs', import.meta.url), [scenario]);
}

/** The whole sequence the row view writes, which every complete scenario produces. */
const sequence = 'PATHS\n0: one.txt\n1: two words.txt\nEND\n';

/** The sequence a source that fails after its first row leaves behind. */
const partial = 'PATHS\n0: one.txt\n';

/** The incomplete-result line, which names the Command and both counts. */
function incomplete(subject: string, yielded: number, written: number) {
  return `Output is incomplete: ${subject} stopped after ${String(yielded)} rows, ${String(written)} written.\n`;
}

test('a row view writes head, each row, and tail under a synchronous iterable', async () => {
  await expect(rows('sync')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${sequence}resolved:0\n`,
  });
});

test('an asynchronous source writes the same sequence as it yields', async () => {
  await expect(rows('async')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${sequence}resolved:0\n`,
  });
});

test('an empty sequence still writes head and tail', async () => {
  await expect(rows('empty')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'PATHS\nEND\nresolved:0\n',
  });
});

test('a row view tail receives the number of rows written through out.render', async () => {
  await expect(rows('counted-tail')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '0: one.txt\n1: two words.txt\nCOUNT:2\nresolved:0\n',
  });
});

test('core requests no row until the previous piece has been written', async () => {
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
  await expect(rows('back-pressure')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${JSON.stringify(watched)}\nresolved:0\n`,
  });
});

test('a later print on the same destination writes after an unawaited sequence', async () => {
  await expect(rows('order')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${sequence}after\nresolved:0\n`,
  });
});

test('a pending sequence keeps the invocation open until its source ends', async () => {
  await expect(rows('open')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${sequence}resolved:0\n`,
  });
});

test('a source that throws under an awaited call reports the incomplete line first', async () => {
  await expect(rows('source-awaited')).resolves.toEqual({
    status: 1,
    stderr: `${incomplete('Command "count"', 1, 1)}The source failed.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('the same failure under an unawaited call reports after the action with its own code', async () => {
  await expect(rows('source-deferred')).resolves.toEqual({
    status: 1,
    stderr: `${incomplete('Command "count"', 1, 1)}The source failed.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('the line names the root Command where the root action rendered the sequence', async () => {
  await expect(rows('root')).resolves.toEqual({
    status: 1,
    stderr: `${incomplete('the root Command', 1, 1)}The source failed.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('a row view that throws mid-sequence leaves the rows before it written', async () => {
  await expect(rows('row-broken')).resolves.toEqual({
    status: 1,
    stderr: `${incomplete('Command "count"', 2, 1)}rows: Something went wrong.\n`,
    stdout: `${partial}resolved:1\n`,
  });
});

test('a failed write stops the sequence and counts the rows it had written', async () => {
  await expect(rows('write-fails')).resolves.toEqual({
    status: 1,
    stderr: `${incomplete('Command "count"', 2, 1)}rows: Something went wrong.\n`,
    stdout: `${JSON.stringify(['PATHS\n', '0: one.txt\n'])}\nresolved:1\n`,
  });
});

test('a cancelled run whose source then returns writes the line alone', async () => {
  await expect(rows('cancelled')).resolves.toEqual({
    status: 130,
    stderr: incomplete('Command "count"', 1, 1),
    stdout: `${partial}resolved:130\n`,
  });
});

test('an override of incompleteResult that returns the empty string silences the line', async () => {
  await expect(rows('silenced')).resolves.toEqual({
    status: 1,
    stderr: 'The source failed.\n',
    stdout: `${partial}resolved:1\n`,
  });
});

test('an override that throws writes nothing for the line and leaves the report intact', async () => {
  await expect(rows('line-broken')).resolves.toEqual({
    status: 1,
    stderr: 'The source failed.\n',
    stdout: `${partial}resolved:1\n`,
  });
});
