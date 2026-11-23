// Acceptance plan: see packages/plugins/tests/table-fit.test.ts.
import { style } from '@loomcli/core';
import type { RowView, ViewContext } from '@loomcli/core';
import type { ViewValues } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

import { records } from '../src/records.js';
import { table } from '../src/table.js';
import { lines, render } from './fit-render.js';
import { renderEach, renderStream } from './fixtures/view-run.ts';
import { TAB, expandTabs, linesOf, measured, width, wordsOf, wrap } from './view-measures.js';

/** The formatters a run-policy case names: an OSC 8 hyperlink and a raw SGR color, as an author's own bytes. */
const formats = {
  link: (value: unknown) =>
    `\u001B]8;;https://example.com\u001B\\${String(value)}\u001B]8;;\u001B\\`,
  sgr: (value: unknown) => `\u001B[31m${String(value)}\u001B[39m`,
};

const tagRows = [
  { key: 'tags', kind: 'array of 12 strings, none empty or longer than 40 characters' },
];

/** What a row view prints for `rows` and their counted tail, on one context. */
function rendered<Row>(view: RowView<Row>, rows: readonly Row[], context: ViewContext): string {
  return `${rows.map((row, index) => view.row(row, index, context)).join('')}${view.tail?.(rows.length, context) ?? ''}`;
}

/** The lines a row view shows for `rows` at `columns`, or piped when undefined, with its tail. */
function shown<Row>(
  view: RowView<Row>,
  rows: readonly Row[],
  columns: number | undefined,
  values: ViewValues = {},
): string[] {
  return linesOf(rendered(view, rows, measured(view, columns, values)));
}

/** Every line is at most `columns` wide. */
function expectFits(each: readonly string[], columns: number): void {
  for (const line of each) {
    expect(width(line)).toBeLessThanOrEqual(columns);
  }
}

/** The columns before a shown line's first character other than a space. */
const indentOf = (line: string): number => line.length - line.trimStart().length;

test('a value wraps at the width left after the key column and its gap, its later lines under the value', () => {
  const view = records<(typeof tagRows)[number]>({ identifier: 'key' });
  const wraps = vi.fn(wrap);
  const output = shown(view, tagRows, 30, { wrap: wraps });
  expect(wraps).toHaveBeenCalledWith(tagRows[0]?.kind, 30 - 'kind'.length - 2);
  expectFits(output, 30);
  const value = output.slice(1, output.indexOf(''));
  expect(value.length).toBeGreaterThan(1);
  for (const line of value.slice(1)) {
    expect(indentOf(line)).toBe(value[0]?.indexOf('array'));
  }
  expect(
    value.map((line, index) => (index === 0 ? line.slice('kind'.length) : line).trim()).join(' '),
  ).toBe(tagRows[0]?.kind);
  expect(output.at(-1)).toBe('1 record');
});

test('a value whose trailing space would overflow the width wraps, so every line fits', () => {
  const view = records<{ key: string; note: string }>({ identifier: 'key' });
  const output = shown(view, [{ key: 'a', note: 'compile the core package ' }], 18);
  expectFits(output, 18);
  expect(output.some((line) => line.includes('core package'))).toBe(false);
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
  async ({ format, lines: expected, rendering }) => {
    const rows = [{ key: 'a', note: 'see the release notes' }];
    const view = records<{ key: string; note: string }>({
      fields: ['key', { format: formats[format], key: 'note' }],
      identifier: 'key',
    });
    const output = await renderEach({ rendering, widths: [20] }, (out) => out.render(rows, view));
    expect(output.split('\n').slice(1, 3)).toEqual(expected);
  },
);

test('an authored line break in a value continues under the value on a terminal', () => {
  const view = records<{ key: string; kind: string }>({ identifier: 'key' });
  const [, first = '', second = ''] = shown(view, [{ key: 'one', kind: 'first\nsecond' }], 80);
  expect(first.endsWith('first')).toBe(true);
  expect(second.trim()).toBe('second');
  expect(indentOf(second)).toBe(first.indexOf('first'));
});

test('a blank line in a styled default value carries no indent', () => {
  // A default value sits in a primary style frame, so its blank line is a frame with no character.
  const view = records<{ key: string; kind: string }>({ identifier: 'key' });
  const output = shown(view, [{ key: 'one', kind: 'first\n\nthird' }], 80, { style });
  expect(output.slice(1, 4).map(wordsOf)).toEqual([['kind', 'first'], [], ['third']]);
  expect(output[2]).toBe('');
});

test('a blank line in a plain format value carries no indent', () => {
  const view = records<{ key: string; kind: string }>({
    fields: ['key', { format: (value) => `${value}\n\nafter`, key: 'kind' }],
    identifier: 'key',
  });
  const output = shown(view, [{ key: 'one', kind: 'first' }], 80);
  expect(output.slice(1, 4).map(wordsOf)).toEqual([['kind', 'first'], [], ['after']]);
  expect(output[2]).toBe('');
});

test('a blank line in a right-aligned fallback value carries no indent and no alignment', () => {
  const view = table<{ name: string; note: string }>({
    columns: ['name', { align: 'right', format: (value) => `${value}\n\nafter`, key: 'note' }],
  });
  const output = linesOf(view.render([{ name: 'abcdefghijkl', note: 'one' }], measured(view, 12)));
  expect(output.map(wordsOf)).toEqual([['name', 'abcdefghijkl'], ['note', 'one'], [], ['after']]);
  expect(output[2]).toBe('');
});

test('a value with no column left after the label stays unwrapped', () => {
  const view = records<{ key: string; kind: string }>({ identifier: 'key' });
  const wraps = vi.fn(wrap);
  const output = shown(view, [{ key: 'one', kind: 'two words' }], 6, { wrap: wraps });
  expect(wraps).not.toHaveBeenCalled();
  expect(output.some((line) => line.endsWith('two words'))).toBe(true);
});

test('a streamed row after a resize wraps at the new width, and the rows before keep theirs', async () => {
  const kind = 'array of 12 strings, none empty or longer than 40 characters';
  const rows = [
    { key: 'before', kind },
    { key: 'after', kind },
  ];
  const view = records<{ key: string; kind: string }>({ identifier: 'key' });
  const streamed = await renderStream({ widths: [100, 30] }, rows, view);
  const output = streamed.split('\n');
  expect(output).toContain(`kind  ${kind}`);
  const start = output.indexOf('key   after');
  const block = output.slice(start, output.indexOf('', start));
  for (const line of block) {
    expect(line.length).toBeLessThanOrEqual(30);
  }
  expect(
    block
      .slice(1)
      .map((line) => line.slice('kind  '.length))
      .join(' '),
  ).toBe(kind);
});

test.each([{ invoke: false }, { invoke: true }])(
  'records piped or invoked by name ($invoke) are byte for byte today, authored breaks and COLUMNS included',
  async ({ invoke }) => {
    const rows = [{ key: 'one', kind: 'first\nsecond words here' }];
    const view = records<{ key: string; kind: string }>({ identifier: 'key' });
    const env = { COLUMNS: '10' };
    await expect(
      renderEach({ env, invoke, widths: [null] }, (out) => out.render(rows, view)),
    ).resolves.toBe(lines('key   one', 'kind  first', 'second words here', '', '1 record'));
  },
);

test('COLUMNS narrows records on a terminal and spares a pipe', () => {
  const config = { identifier: 'key' };
  const env = { COLUMNS: '30' };
  const wrapped = render({ config, rows: tagRows, view: 'records', widths: [30] });
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
  const fallback = table<(typeof rows)[number]>();
  const viewed = records<(typeof rows)[number]>({ identifier: 'name' });
  const context = measured(viewed, 15);
  const blocks = rows.map((row, index) => viewed.row(row, index, context)).join('');
  expect(fallback.render(rows, measured(fallback, 15))).toBe(blocks);
});

test('a tab in a value expands from the start of the value before it wraps, so no line overflows', () => {
  const view = records<{ first: string }>({ identifier: 'first' });
  const tabs = vi.fn(expandTabs);
  const output = shown(view, [{ first: 'b\tc' }], 16, { expandTabs: tabs });
  expect(tabs).toHaveBeenCalledWith('b\tc');
  expectFits(output, 16);
  expect(output[0]).toContain(`b${TAB}c`);
});

test('a tab after a wrapped break expands from the start of the value, not its output line', () => {
  const view = records<{ first: string }>({ identifier: 'first' });
  const tabs = vi.fn(expandTabs);
  const wraps = vi.fn(wrap);
  const output = shown(view, [{ first: 'aaa bbbbbb\tc' }], 16, { expandTabs: tabs, wrap: wraps });
  expect(tabs).toHaveBeenCalledWith('aaa bbbbbb\tc');
  expect(wraps).toHaveBeenCalledWith(`aaa bbbbbb${TAB}c`, 16 - 'first'.length - 2);
  expect(output.join('\n')).not.toContain('\t');
  expectFits(output, 16);
});

test('a tab stays a tab in piped records', () => {
  const view = records<{ first: string }>({ identifier: 'first' });
  const tabs = vi.fn(expandTabs);
  expect(shown(view, [{ first: 'b\tc' }], undefined, { expandTabs: tabs })[0]).toContain('b\tc');
  expect(tabs).not.toHaveBeenCalled();
});

test.each([
  { identifier: 'id', row: { id: 'one', to: null } },
  { identifier: 'key', row: { key: 'one', to: null } },
])(
  'a label line with an empty value ends at its label on a terminal, under $identifier',
  ({ identifier, row }) => {
    const view = records<Record<string, string | null>>({ identifier });
    expect(shown(view, [row], 40)).toContain('to');
  },
);

test('an empty value keeps its label padding and gap on a pipe', () => {
  const view = records<{ key: string; to: null }>({ identifier: 'key' });
  const label = shown(view, [{ key: 'one', to: null }], undefined).find((line) =>
    line.startsWith('to'),
  );
  expect(label?.trim()).toBe('to');
  expect(label).not.toBe('to');
});

test('a fallback line with an empty header and an empty value is an empty line', () => {
  const view = table<{ name: string; note: null }>({
    columns: ['name', { header: '', key: 'note' }],
  });
  const output = linesOf(view.render([{ name: 'abcdefghijkl', note: null }], measured(view, 12)));
  expect(output).toHaveLength(2);
  expect(output[1]).toBe('');
});
