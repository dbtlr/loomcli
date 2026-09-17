import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/records.mjs', import.meta.url);

test('records() renders rows and a counted tail through out.render', () => {
  expect(invoke(fixture, ['default'])).toEqual({
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

test('records() renders as a declared row view through out.results', () => {
  expect(invoke(fixture, ['declared'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'key   user\nkind  object\n\n1 record\nresolved:0\n',
  });
});

test('records() uses one declared key width and preserves field order across rows', () => {
  expect(invoke(fixture, ['explicit'])).toEqual({
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

test('records() discovers own fields in first-seen order with a width local to each row', () => {
  expect(invoke(fixture, ['row-width'])).toEqual({
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

test('records() prints null and undefined as empty values', () => {
  expect(invoke(fixture, ['nullish'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'nullish  \nmissing  \nkey      one\n\n1 record\nresolved:0\n',
  });
});

test('records() leaves formatted text authored and escapes default data values', () => {
  const result = invoke(fixture, ['escape']);
  const marker = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain(marker);
  expect(result.stdout).toContain('authored  data\n');
  expect(result.stdout.split(marker)).toHaveLength(2);
});

test('records() does not add a line when the fields omit the identifier', () => {
  expect(invoke(fixture, ['identifier-omitted'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'kind  object\n\n1 record\nresolved:0\n',
  });
});

test('records() prints a zero-record tail for an empty sequence', () => {
  expect(invoke(fixture, ['empty'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '0 records\nresolved:0\n',
  });
});
