// Acceptance plan: see packages/plugins/tests/table.test.ts.
import { expect, test } from 'vite-plus/test';

import { run as fixtureRun } from './fixtures/records.js';

test('records() renders rows and a counted tail through out.render', async () => {
  await expect(fixtureRun(['default'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: [
      'key   user',
      'kind  object with 3 keys',
      '',
      'key   tags',
      'kind  array with 2 items',
      '',
      '2 records',
      'resolved:0',
      '',
    ].join('\n'),
  });
});

test('records() renders as a declared row view through out.results', async () => {
  await expect(fixtureRun(['declared'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'key   user\nkind  object\n\n1 record\nresolved:0\n',
  });
});

test('records() uses one declared key width and preserves field order across rows', async () => {
  await expect(fixtureRun(['explicit'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: [
      'kind  object',
      'key   user',
      '',
      'kind  array',
      'key   tags',
      '',
      '2 records',
      'resolved:0',
      '',
    ].join('\n'),
  });
});

test('records() discovers own fields in first-seen order with a width local to each row', async () => {
  await expect(fixtureRun(['row-width'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: [
      'longest  b',
      'short    a',
      '',
      'xx  c',
      'yy  d',
      '',
      '2 records',
      'resolved:0',
      '',
    ].join('\n'),
  });
});

test('records() prints null and undefined as empty values', async () => {
  await expect(fixtureRun(['nullish'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'nullish  \nmissing  \nkey      one\n\n1 record\nresolved:0\n',
  });
});

test('records() leaves formatted text authored and escapes default data values', async () => {
  const result = await fixtureRun(['escape']);
  const marker = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain(marker);
  expect(result.stdout).toContain('authored  data\n');
  expect(result.stdout.split(marker)).toHaveLength(2);
});

test('records() escapes a data key before styling its label', async () => {
  const result = await fixtureRun(['escaped-key']);
  const marker = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain(marker);
});

test('records() does not add a line when the fields omit the identifier', async () => {
  await expect(fixtureRun(['identifier-omitted'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'kind  object\n\n1 record\nresolved:0\n',
  });
});

test('records() prints a zero-record tail for an empty sequence', async () => {
  await expect(fixtureRun(['empty'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '0 records\nresolved:0\n',
  });
});
