import { expect, test } from 'vite-plus/test';

import { lines, render } from './fit-render.js';

const tagRows = [
  { key: 'tags', kind: 'array of 12 strings, none empty or longer than 40 characters' },
];

test('a value wraps at the width left after the key column and its gap', () => {
  const config = { identifier: 'key' };
  expect(render({ config, rows: tagRows, view: 'records', widths: [30] })).toBe(
    lines(
      'key   tags',
      'kind  array of 12 strings,',
      '      none empty or longer',
      '      than 40 characters',
      '',
      '1 record',
    ),
  );
});

test('a value whose trailing space would overflow the width wraps, so every line fits', () => {
  const rows = [{ key: 'a', note: 'compile the core package ' }];
  const output = render({ config: { identifier: 'key' }, rows, view: 'records', widths: [18] });
  expect(Math.max(...output.split('\n').map((line) => line.length))).toBeLessThanOrEqual(18);
  expect(output).toBe(
    lines('key   a', 'note  compile the', '      core', '      package ', '', '1 record'),
  );
});

test.each([
  {
    format: 'link',
    lines: [
      'note  \u001B]8;;https://example.com\u001B\\see the\u001B]8;;\u001B\\',
      '      \u001B]8;;https://example.com\u001B\\release notes\u001B]8;;\u001B\\',
    ],
    rendering: { color: 'never', hyperlinks: 'always', modifiers: 'never' },
  },
  {
    format: 'sgr',
    lines: ['note  \u001B[31msee the\u001B[39m', '      \u001B[31mrelease notes\u001B[39m'],
    rendering: { color: 'always', modifiers: 'never' },
  },
] as const)(
  'a $format value that wraps leaves its continuation indent bare',
  ({ format, lines: expected, rendering }) => {
    const rows = [{ key: 'a', note: 'see the release notes' }];
    const config = { fields: ['key', { format, key: 'note' }], identifier: 'key' };
    const output = render({ config, rendering, rows, view: 'records', widths: [20] });
    expect(output.split('\n').slice(1, 3)).toEqual(expected);
  },
);

test('an authored line break in a value continues under the value on a terminal', () => {
  const config = { identifier: 'key' };
  const rows = [{ key: 'one', kind: 'first\nsecond' }];
  expect(render({ config, rows, view: 'records', widths: [80] })).toBe(
    lines('key   one', 'kind  first', '      second', '', '1 record'),
  );
});

test('a blank line in a styled default value carries no indent', () => {
  // A default value sits in a primary style frame, so its blank line is a frame with no character.
  const rows = [{ key: 'one', kind: 'first\n\nthird' }];
  expect(render({ config: { identifier: 'key' }, rows, view: 'records', widths: [80] })).toBe(
    lines('key   one', 'kind  first', '', '      third', '', '1 record'),
  );
});

test('a blank line in a plain format value carries no indent', () => {
  const rows = [{ key: 'one', kind: 'first' }];
  const config = { fields: ['key', { format: 'blank', key: 'kind' }], identifier: 'key' };
  expect(render({ config, rows, view: 'records', widths: [80] })).toBe(
    lines('key   one', 'kind  first', '', '      after', '', '1 record'),
  );
});

test('a blank line in a right-aligned fallback value carries no indent and no alignment', () => {
  const rows = [{ name: 'abcdefghijkl', note: 'one' }];
  const config = { columns: ['name', { align: 'right', format: 'blank', key: 'note' }] };
  expect(render({ config, rows, view: 'table', widths: [12] })).toBe(
    lines('name  abcdefghijkl', 'note    one', '', '      after'),
  );
});

test('a value with no column left after the label stays unwrapped', () => {
  const config = { identifier: 'key' };
  const rows = [{ key: 'one', kind: 'two words' }];
  expect(render({ config, rows, view: 'records', widths: [6] })).toBe(
    lines('key   one', 'kind  two words', '', '1 record'),
  );
});

test('a streamed row after a resize wraps at the new width, and the rows before keep theirs', () => {
  const config = { identifier: 'key' };
  const kind = 'array of 12 strings, none empty or longer than 40 characters';
  const rows = [
    { key: 'before', kind },
    { key: 'after', kind },
  ];
  expect(render({ config, rows, stream: true, view: 'records', widths: [100, 30] })).toBe(
    lines(
      `key   before`,
      `kind  ${kind}`,
      '',
      'key   after',
      'kind  array of 12 strings,',
      '      none empty or longer',
      '      than 40 characters',
      '',
      '2 records',
    ),
  );
});

test.each([{ invoke: false }, { invoke: true }])(
  'records piped or invoked by name ($invoke) are byte for byte today, authored breaks and COLUMNS included',
  ({ invoke }) => {
    const config = { identifier: 'key' };
    const rows = [{ key: 'one', kind: 'first\nsecond words here' }];
    const env = { COLUMNS: '10' };
    expect(render({ config, env, invoke, rows, view: 'records', widths: [null] })).toBe(
      lines('key   one', 'kind  first', 'second words here', '', '1 record'),
    );
  },
);

test('COLUMNS narrows records on a terminal and spares a pipe', () => {
  const config = { identifier: 'key' };
  const env = { COLUMNS: '30' };
  const wrapped = lines(
    'key   tags',
    'kind  array of 12 strings,',
    '      none empty or longer',
    '      than 40 characters',
    '',
    '1 record',
  );
  expect(render({ config, env, rows: tagRows, view: 'records', widths: [100] })).toBe(wrapped);
  expect(render({ config, env, rows: tagRows, view: 'records', widths: ['unreported'] })).toBe(
    wrapped,
  );
  expect(render({ config, env, rows: tagRows, view: 'records', widths: [null] })).toContain(
    'kind  array of 12 strings, none empty or longer than 40 characters\n',
  );
});

test('the table fallback prints the same blocks as the records view for the same labels', () => {
  const rows = [
    { name: 'abcdefghijkl', note: 'one two three four five' },
    { name: 'second', note: 'tail' },
  ];
  const fallback = render({ config: {}, rows, view: 'table', widths: [15] });
  const viewed = render({ config: { identifier: 'name' }, rows, view: 'records', widths: [15] });
  expect(fallback).toContain('name');
  expect(`${fallback}\n2 records\n`).toBe(viewed);
});

test('a tab in a value expands from the start of the value before it wraps, so no line overflows', () => {
  const output = render({
    config: { identifier: 'first' },
    rows: [{ first: 'b\tc' }],
    view: 'records',
    widths: [16],
  });
  for (const line of output.split('\n')) {
    expect(line).not.toContain('\t');
    expect(line.length).toBeLessThanOrEqual(16);
  }
  expect(output).toBe(lines('first  b       c', '', '1 record'));
});

test('a tab stays a tab in piped records', () => {
  const rows = [{ first: 'b\tc' }];
  expect(render({ config: { identifier: 'first' }, rows, view: 'records', widths: [null] })).toBe(
    lines('first  b\tc', '', '1 record'),
  );
});
