/*
 * Acceptance plan for the table and records views (docs/plugins/pack-views.md#table).
 *
 * The acceptance tests cover:
 *
 * - each factory as the second argument of `out.render` and as an entry of a declared result, a
 *   column measured against a wide CJK cell and against a styled cell, a `null` and an `undefined`
 *   cell under each factory, one key listed twice as two columns, a `format` cell that returns
 *   styled text the view leaves unescaped beside a default cell in the same row that the view
 *   escapes, the all-keys default in first-seen order under each factory, an empty sequence under
 *   the table with `columns` printing the header line alone and without `columns` printing nothing,
 *   an empty sequence under records printing `0 records`, a one-row sequence printing `1 record`,
 *   and `tail` receiving the row count under `out.render` and under `out.results` alike.
 * - The negative type checks cover a column that names a key the row does not carry, a records
 *   field that carries `header`, an `identifier` that names a key the row does not carry, and a
 *   `format` whose value parameter is typed as something other than the key's own value type, each
 *   inside a `views` record and as the second argument of `out.render`, the records cases over an
 *   array, a generator, and an async generator, and a table over a generator rejected because a
 *   whole view renders a value. Each case runs under Node and Bun.
 */

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/table.mjs', import.meta.url);

test('table() renders explicit columns through out.render', () => {
  expect(invoke(fixture, ['explicit'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  source\n    6  one.txt\n    2  two words.txt\nresolved:0\n',
  });
});

test('table() discovers own keys in first-seen order when columns are omitted', () => {
  expect(invoke(fixture, ['defaults'])).toEqual({
    status: 0,
    stderr: '',
    stdout:
      'source         count  extra\none.txt        6      \ntwo words.txt  2      yes\nresolved:0\n',
  });
});

test('table() renders as a declared whole view through out.results', () => {
  expect(invoke(fixture, ['declared'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'source        count\ndeclared.txt  3\nresolved:0\n',
  });
});

test('table() permits one key twice with independent formatting', () => {
  expect(invoke(fixture, ['duplicate-key'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  TENS\n2      20\nresolved:0\n',
  });
});

test('table() prints null and undefined as empty cells', () => {
  expect(invoke(fixture, ['nullish'])).toEqual({
    status: 0,
    stderr: '',
    stdout: `nullish  missing  end\n${' '.repeat(18)}x\nresolved:0\n`,
  });
});

test('table() measures wide and styled cells with the view context', () => {
  expect(invoke(fixture, ['styled-wide'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'N       count\n猫猫        1\nstyled     20\nresolved:0\n',
  });
});

test('table() leaves formatted text authored and escapes default data cells', () => {
  const result = invoke(fixture, ['escape']);
  const marker = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain(marker);
  expect(result.stdout).toContain('  data\nresolved:0\n');
  expect(result.stdout.split(marker)).toHaveLength(2);
});

test('table() escapes a discovered key before styling its header', () => {
  const result = invoke(fixture, ['escaped-key']);
  const marker = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain(marker);
});

test('table() measures a large finite sequence without an argument overflow', () => {
  expect(invoke(fixture, ['large'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'resolved:0\n',
  });
});

test('table() centers its last column without trailing padding', () => {
  expect(invoke(fixture, ['last-center'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'ABCD\n x\nresolved:0\n',
  });
});

test('table() prints only configured headers for an empty sequence', () => {
  expect(invoke(fixture, ['empty-explicit'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'source  count\nresolved:0\n',
  });
});

test('table() prints nothing for an empty sequence with no known columns', () => {
  expect(invoke(fixture, ['empty-default'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'resolved:0\n',
  });
});
