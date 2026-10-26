/*
 * Acceptance plan for the table and records fit (docs/plugins/pack-views.md#table).
 *
 * Each case runs under Node and Bun. A case about one view at a width calls the view through
 * viewContext with the simple measures of view-measures.ts and checks the branch the view took and
 * the content it printed, not its layout; the levelling formula is checked on `levelWidths` itself.
 * A case about the run around a view, embedded color and hyperlinks under a rendering policy, a
 * resize, `COLUMNS`, a pipe, an invocation by name, or a streamed row, renders in a child process
 * and checks exact bytes, pack-fit.test.ts checks once per view that a real render fits a narrow
 * terminal, and a pty-backed host checks the resize cases. The acceptance tests cover:
 *
 * - At natural width. A table whose natural width is less than `columns`, one exactly equal to it,
 *   and one under `columns` undefined each print the natural-width bytes.
 * - Shrunk. A table one column wider than `columns` shrinks levelling from the top: the widest
 *   column narrows to tie the next widest, and then both narrow together. When the tied columns
 *   cannot narrow by a whole column each, the leftover columns go one each to the tied columns from
 *   left to right. Cells wrap inside their columns with every value complete, each line of a
 *   wrapped cell keeps its column's alignment under `right` and `center`, each line ends at its
 *   rightmost cell that has text, which carries no padding, so a middle cell taller than the last
 *   ends its extra lines at its own text, with no gap or padding after it, a shorter cell to the
 *   left of a cell with text adds a padded blank line, and the two-space gap counts toward the fit.
 *   A `format` cell is measured and wrapped by its output.
 * - The whole width. A shrunk table's fitted widths and gaps total exactly `columns`, and with a
 *   last cell that fills its column, which a right-aligned last column and a full line of wrapped
 *   text give, its widest line equals `columns`. The formula is checked with natural widths 40, 20,
 *   and 6: 46 columns left for cells give 20, 20, and 6, 40 give 17, 17, and 6, and 39 give 17, 16,
 *   and 6, with the remainder going from the left to the columns at exactly L whose natural width
 *   exceeds L.
 * - Headers. A header wider than every cell sets its column's natural width, a header word longer
 *   than every cell word sets its floor, and a header wraps like a cell.
 * - Floors. A column's floor is the widest unit `wrap` keeps whole: a word, with an input line's
 *   leading spaces on its first word and its trailing spaces on its last, or a `pad` frame or a
 *   `nowrap` frame, within one input line. A cell `Ada Lovelace ` whose trailing space would pass
 *   its column wraps instead, so every line fits and the next column stays aligned, and a cell
 *   `abcd      ` is one unit ten columns wide. A cell in `nowrap` raises its column's floor to the
 *   whole cell. Columns held at their floors by a long word stay at the floor while the others
 *   narrow.
 * - An empty sequence. An empty sequence with a `columns` list configured prints its header line at
 *   the fitted widths, levelled and wrapped like any header row, and never takes the records
 *   fallback, however narrow `columns` is. When even the header floors exceed `columns`, every
 *   column sits at its floor and the line overflows. With no `columns` list it prints nothing.
 * - Records fallback. A table with rows whose floors do not fit `columns` prints one block per row
 *   with the header text, or the key as written, as labels, no header line, wrapped values with
 *   their column's styling and `format`, and one blank line between blocks. A right- or
 *   center-aligned value aligns within its own widest wrapped line, no value line carries trailing
 *   padding, and a blank line inside a value carries no alignment and no indent. A fallback line
 *   with an empty header and an empty value is an empty line. Overflow happens only where a unit
 *   `wrap` keeps whole, or a label, exceeds the space.
 * - The records view. On a terminal each value wraps at the width left after the padded key column,
 *   every continuation line of a value, authored or wrapped, is indented under the value, a blank
 *   line inside a styled default value or a plain `format` value carries no indent, a line whose
 *   value is `null` ends at its key with no padding or gap, so `{ id: 'one', to: null }` at 40
 *   columns prints `to` alone and a key column three wide leaves no padding after `to`, while a
 *   pipe keeps the padding and the gap, and the fallback's row blocks match the records view's row
 *   blocks for the same labels and left-aligned values, while the fallback has no tail and
 *   highlights no identifier. With no column left for the value, the value stays unwrapped.
 * - A resize. Under a pty-backed host, one run renders a table at 100 columns, the window resizes
 *   to 60, and the next render fits 60. A streamed records row after the resize wraps at 60, and
 *   the rows before it keep their layout.
 * - `COLUMNS`. `COLUMNS=60` over a real width of 100 narrows a table and a records value to 60,
 *   `COLUMNS=150` over 100 changes nothing, `COLUMNS=60` on a terminal that reports no width fits
 *   60, and `COLUMNS=60` on a pipe changes nothing.
 * - Tabs. At 16 columns a table with cells `abcde` and `b\tc d` prints `abcde  b       c` and then
 *   `       d`, a records value `b\tc` under the key `first` prints `first  b       c`, and a
 *   header holding a tab expands as a cell does, so no line passes 16 columns and none holds a tab.
 *   A tab in a styled cell expands inside its style, and a tab in a `nowrap` cell expands while the
 *   cell stays whole. Piped, the table and the records value keep the tab.
 * - Embedded ANSI. A `format` cell holding an OSC 8 hyperlink, wrapped at 20 columns beside an
 *   `owner` column, closes the link at the end of each line, so the link covers neither the gap nor
 *   `drew`, and a cell holding a raw SGR color colors no neighbor. A records value holding either
 *   wraps with a continuation indent that carries no link and no color. The views split each
 *   wrapped value with `splitLines`.
 * - Piped output. A table and a records view rendered to a pipe, under `app.invoke`, and under an
 *   MCP tool call are byte for byte the natural-width output, `COLUMNS` set or not. This holds for
 *   a `format` cell that returns several lines, a records value with authored line breaks, and a
 *   cell or value holding a tab, because the per-line row layout and tab expansion apply only when
 *   `columns` is defined.
 */

import type { View } from '@loomcli/core';
import type { ViewValues } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

import { levelWidths } from '../src/table-fit.js';
import { table } from '../src/table.js';
import { filler, lines, render } from './fit-render.js';
import {
  TAB,
  expandTabs,
  linesOf,
  measured,
  width as measure,
  wordsOf,
  wrap,
} from './view-measures.js';

const noteRows = [
  { name: 'build', note: 'compiles every package and bundles the examples' },
  { name: 'check', note: 'runs the formatter, the linter, and the type checker' },
];
const noteColumns = {
  columns: [
    { header: 'NAME', key: 'name' },
    { header: 'NOTE', key: 'note' },
  ],
} as const;

/** The lines a table shows for `rows` at `columns`, or piped when undefined. */
function shown<Row>(
  view: View<readonly Row[]>,
  rows: readonly Row[],
  columns: number | undefined,
  values: ViewValues = {},
): string[] {
  return linesOf(view.render(rows, measured(view, columns, values)));
}

/** Every line is at most `columns` wide. */
function expectFits(each: readonly string[], columns: number): void {
  for (const line of each) {
    expect(measure(line)).toBeLessThanOrEqual(columns);
  }
}

/** Whether `text` sits whole on one line. */
const onOneLine = (each: readonly string[], text: string): boolean =>
  each.some((line) => line.includes(text));

/** The columns at which the line holding `fragment` has it end, for each fragment. */
const endsOf = (each: readonly string[], fragments: readonly string[]): number[] =>
  fragments.map((fragment) => {
    const line = each.find((candidate) => candidate.includes(fragment)) ?? '';
    return line.indexOf(fragment) + fragment.length;
  });

/** The middle column of the line holding each fragment, doubled so it stays whole. */
const middlesOf = (each: readonly string[], fragments: readonly string[]): number[] =>
  fragments.map((fragment) => {
    const line = each.find((candidate) => candidate.includes(fragment)) ?? '';
    return 2 * line.indexOf(fragment) + fragment.length;
  });

/** The row blocks of a records render: its lines between blank lines. */
const blocksOf = (each: readonly string[]): string[][] =>
  each
    .join('\n')
    .split('\n\n')
    .map((block) => block.split('\n'));

test('a table that fits prints its natural width, exactly at the limit, under it, or piped', () => {
  const view = table<{ name: string; note: string }>({ columns: ['name', 'note'] });
  const rows = [{ name: 'build', note: 'compiles' }];
  const outputs = [15, 40, undefined].map((columns) => view.render(rows, measured(view, columns)));
  expect(new Set(outputs).size).toBe(1);
  expect(linesOf(outputs[0] ?? '').map(wordsOf)).toEqual([
    ['name', 'note'],
    ['build', 'compiles'],
  ]);
});

test('a table one column too wide shrinks, wraps its long values, and keeps every value whole', () => {
  const view = table<(typeof noteRows)[number]>(noteColumns);
  const output = shown(view, noteRows, 30);
  expectFits(output, 30);
  expect(wordsOf(output[0] ?? '')).toEqual(['NAME', 'NOTE']);
  for (const { note } of noteRows) {
    expect(onOneLine(output, note)).toBe(false);
  }
  const every = [
    'NAME',
    'NOTE',
    ...noteRows
      .flatMap(({ name, note }) => [name, note])
      .join(' ')
      .split(' '),
  ];
  expect(wordsOf(output.join('\n')).toSorted()).toEqual(every.toSorted());
});

/** The three-column table whose natural widths are 40, 20, and 6, the last right-aligned. */
const levelled = table<{ middle: string; narrow: string; wide: string }>({
  columns: [
    { header: 'A', key: 'wide' },
    { header: 'B', key: 'middle' },
    { align: 'right', header: 'C', key: 'narrow' },
  ],
});
const levelledRows = [{ middle: filler(20, 'b'), narrow: 'cccccc', wide: filler(40, 'a') }];

test.each([
  { cells: 46, widths: [20, 20, 6] },
  { cells: 40, widths: [17, 17, 6] },
  { cells: 39, widths: [17, 16, 6] },
])(
  'levelling from the top gives $widths with $cells columns for cells, and the table fills the width',
  ({ cells, widths }) => {
    expect(levelWidths([40, 20, 6], [5, 5, 6], cells)).toEqual(widths);
    const output = shown(levelled, levelledRows, cells + 4);
    expect(Math.max(...output.map(measure))).toBe(cells + 4);
    expect(wordsOf(output.join('\n')).filter((word) => word.startsWith('a'))).toEqual(
      filler(40, 'a').split(' '),
    );
  },
);

test.each([
  // L is 5, and the first column sits at 5 by its natural width, so it is not naturally wider.
  { available: 16, expected: [5, 6, 5], floors: [1, 1, 1], natural: [5, 10, 10] },
  // L is 15, and the first column is naturally wider but held at its floor of 30, not at L.
  { available: 61, expected: [30, 16, 15], floors: [30, 1, 1], natural: [40, 20, 20] },
])(
  'the remainder skips a column at L by its natural width and one held above L by its floor: $expected',
  ({ available, expected, floors, natural }) => {
    expect(levelWidths(natural, floors, available)).toEqual(expected);
  },
);

test('the remainder goes one column each from the left to the tied columns', () => {
  expect(levelWidths([30, 30, 30], [5, 6, 5], 80)).toEqual([27, 27, 26]);
});

test('a column held at its floor by a long word stays whole while the others narrow', () => {
  const view = table<{ tail: string; word: string }>({ columns: ['word', 'tail'] });
  const output = shown(view, [{ tail: filler(40, 't'), word: 'abcdefghijklmnopqrst uv' }], 40);
  expectFits(output, 40);
  expect(onOneLine(output, 'abcdefghijklmnopqrst')).toBe(true);
  expect(onOneLine(output, filler(40, 't'))).toBe(false);
});

test('a cell whose trailing space would overflow its column wraps, so every line fits', () => {
  const view = table<{ name: string; role: string }>();
  const rows = [
    { name: 'Ada Lovelace ', role: 'math' },
    { name: 'Bo', role: 'ops' },
  ];
  const output = shown(view, rows, 18);
  expectFits(output, 18);
  expect(onOneLine(output, 'Ada Lovelace')).toBe(false);
  expect(wordsOf(output.join('\n')).toSorted()).toEqual(
    ['name', 'role', 'Ada', 'Lovelace', 'math', 'Bo', 'ops'].toSorted(),
  );
});

/**
 * The row blocks of a records render, each as the labels its lines start with, after checking
 * that no line is a header line holding every label.
 */
function recordLabels(output: readonly string[], labels: readonly string[]): string[][] {
  expect(output.some((line) => labels.every((label) => line.includes(label)))).toBe(false);
  return blocksOf(output).map((block) =>
    labels.filter((label) => block.some((line) => line.startsWith(label))),
  );
}

/*
 * The floor of the word column is 10, the whole of `abcd      `, because an input line's trailing
 * spaces stay with its last word. With the tail column's floor of 4 and the gap, the floors need
 * 16 columns, more than 12, so the rows print as records blocks instead of a shrunk table.
 */
test('a word with trailing spaces is one unit at its full width, so its floor can force the fallback', () => {
  const view = table<{ tail: string; word: string }>({ columns: ['word', 'tail'] });
  const rows = [
    { tail: 'efgh', word: 'abcd      ' },
    { tail: 'kl', word: 'ij' },
  ];
  expect(recordLabels(shown(view, rows, 12), ['word', 'tail'])).toEqual([
    ['word', 'tail'],
    ['word', 'tail'],
  ]);
});

test('a word with leading spaces is one unit, so its column floor counts the spaces', () => {
  const view = table<{ tail: string; word: string }>({ columns: ['word', 'tail'] });
  const output = shown(view, [{ tail: filler(40, 't'), word: '    abcdef gh' }], 20);
  expectFits(output, 20);
  expect(output.some((line) => line.startsWith('    abcdef'))).toBe(true);
});

test('a unit wrap keeps whole, such as a pad or nowrap frame, sets its column floor, so the column never narrows below it', () => {
  const view = table<{ note: string; path: string }>({
    columns: [{ header: 'P', key: 'path' }, 'note'],
  });
  const keeps = vi.fn((text: string, limit: number | undefined) =>
    text === 'a b c d e f' ? text : wrap(text, limit),
  );
  const output = shown(view, [{ note: filler(40, 'n'), path: 'a b c d e f' }], 30, { wrap: keeps });
  expect(keeps).toHaveBeenCalledWith('a b c d e f', 1);
  expectFits(output, 30);
  expect(output.some((line) => line.startsWith('a b c d e f'))).toBe(true);
  expect(onOneLine(output, filler(40, 'n'))).toBe(false);
});

test.each(['right', 'center'] as const)(
  'each line of a wrapped %s-aligned cell keeps the column alignment',
  (align) => {
    const view = table<{ note: string; text: string }>({
      columns: [{ align, header: 'N', key: 'text' }, 'note'],
    });
    const output = shown(view, [{ note: 'x', text: 'aaa b cc dddd' }], 12);
    expectFits(output, 12);
    const fragments = ['N', 'aaa b', 'cc', 'dddd'];
    const placed = align === 'right' ? endsOf(output, fragments) : middlesOf(output, fragments);
    expect(Math.max(...placed) - Math.min(...placed)).toBeLessThanOrEqual(
      align === 'right' ? 0 : 2,
    );
  },
);

test('a line ends at its rightmost cell with text, which carries no padding, and an earlier shorter cell pads blank lines', () => {
  const rows = [{ long: 'one two three', short: 'x' }];
  const long = { header: 'L', key: 'long' } as const;
  const short = { header: 'S', key: 'short' } as const;
  const after = shown(table<(typeof rows)[number]>({ columns: [long, short] }), rows, 10);
  const before = shown(table<(typeof rows)[number]>({ columns: [short, long] }), rows, 10);
  for (const line of [...after, ...before]) {
    expect(line).toBe(line.trimEnd());
  }
  expect(after.find((line) => line.includes('three'))).not.toContain('x');
  const continued = before.find((line) => line.includes('three')) ?? '';
  expect(continued.startsWith(' ')).toBe(true);
  expect(continued.trim()).toBe('three');
});

test('a middle cell taller than the last ends its extra lines at its own text, with no gap or padding after', () => {
  const view = table<{ first: string; last: string; middle: string }>({
    columns: [
      { header: 'a', key: 'first' },
      { header: 'b', key: 'middle' },
      { header: 'c', key: 'last' },
    ],
  });
  const output = shown(view, [{ first: 'x', last: 'z', middle: 'one two three' }], 14);
  for (const line of output) {
    expect(line).toBe(line.trimEnd());
  }
  expect(output.find((line) => line.includes('three'))?.trim()).toBe('three');
});

test('a header wider than its cells sets the natural width and wraps like a cell', () => {
  const view = table<{ small: string; text: string }>({
    columns: [{ header: 'ENORMOUS HEADER', key: 'small' }, 'text'],
  });
  const rows = [{ small: 'x', text: filler(30, 'b') }];
  const [header = '', row = ''] = shown(view, rows, undefined);
  expect(header).toContain('ENORMOUS HEADER');
  expect(row.indexOf(filler(30, 'b'))).toBe(header.indexOf('text'));
  const narrow = shown(view, rows, 30);
  expectFits(narrow, 30);
  expect(onOneLine(narrow, 'ENORMOUS HEADER')).toBe(false);
  expect(onOneLine(narrow, 'HEADER')).toBe(true);
});

test('a header word longer than every cell word sets the floor, so every line still fits', () => {
  const view = table<{ small: string; text: string }>({
    columns: [{ header: 'SUPERCALIFRAGILISTIC', key: 'small' }, 'text'],
  });
  const output = shown(view, [{ small: 'x y', text: filler(40, 'b') }], 30);
  expectFits(output, 30);
  expect(onOneLine(output, 'SUPERCALIFRAGILISTIC')).toBe(true);
});

test('an empty sequence prints its header line at the fitted widths', () => {
  const view = table<{ first: string; last: string }>({
    columns: [
      { header: 'FIRST NAME', key: 'first' },
      { header: 'LAST NAME', key: 'last' },
    ],
  });
  const narrow = shown(view, [], 12);
  expectFits(narrow, 12);
  expect(narrow.length).toBeGreaterThan(1);
  expect(wordsOf(narrow.join('\n')).toSorted()).toEqual(['FIRST', 'LAST', 'NAME', 'NAME']);
  const wide = shown(view, [], 40);
  expect(wide).toHaveLength(1);
  expect(wide[0]).toContain('FIRST NAME');
  expect(wide[0]).toContain('LAST NAME');
});

test('an empty sequence overflows at its floors rather than taking the records fallback', () => {
  const view = table<{ ALPHA: string; BETA: string }>({ columns: ['ALPHA', 'BETA'] });
  const output = shown(view, [], 5);
  expect(output).toHaveLength(1);
  expect(wordsOf(output[0] ?? '')).toEqual(['ALPHA', 'BETA']);
});

test('an empty sequence with no columns list prints nothing', () => {
  const view = table<Record<string, unknown>>();
  expect(view.render([], measured(view, 30))).toBe('');
});

test('a table whose floors do not fit renders as records blocks with every value', () => {
  const view = table<{ name: string; note: string }>(noteColumns);
  const rows = [
    { name: 'abcdefghijkl', note: 'one two three four five' },
    { name: 'second', note: 'tail' },
  ];
  const output = shown(view, rows, 15);
  expect(recordLabels(output, ['NAME', 'NOTE'])).toEqual([
    ['NAME', 'NOTE'],
    ['NAME', 'NOTE'],
  ]);
  expect(onOneLine(output, rows[0]?.note ?? '')).toBe(false);
  expect(wordsOf(output.join('\n')).filter((word) => !['NAME', 'NOTE'].includes(word))).toEqual(
    rows
      .flatMap(({ name, note }) => [name, note])
      .join(' ')
      .split(' '),
  );
});

test.each(['right', 'center'] as const)(
  'the records fallback aligns a %s-aligned value within its own widest wrapped line',
  (align) => {
    const view = table<{ text: string; wide: string }>({
      columns: [{ align, key: 'text' }, 'wide'],
    });
    const output = shown(view, [{ text: 'aaa b cc dddd', wide: 'zzzzzzzzzzzzzzz' }], 12);
    expect(recordLabels(output, ['text', 'wide'])).toEqual([['text', 'wide']]);
    const fragments = ['aaa b', 'cc', 'dddd'];
    const placed = align === 'right' ? endsOf(output, fragments) : middlesOf(output, fragments);
    expect(Math.max(...placed) - Math.min(...placed)).toBeLessThanOrEqual(
      align === 'right' ? 0 : 2,
    );
    for (const line of output) {
      expect(line).toBe(line.trimEnd());
    }
  },
);

test('the records fallback keeps a format cell and its color, with every indent bare', () => {
  const rows = [{ name: 'abcdefghijkl', note: 'one two three four five' }];
  const config = {
    columns: [
      { header: 'NAME', key: 'name' },
      { format: 'red', header: 'NOTE', key: 'note' },
    ],
  };
  const rendering = { color: 'always', modifiers: 'never' } as const;
  expect(render({ config, rendering, rows, view: 'table', widths: [15] })).toBe(
    lines(
      'NAME  abcdefghijkl',
      'NOTE  \u001B[31mone two\u001B[39m',
      '      \u001B[31mthree\u001B[39m',
      '      \u001B[31mfour five\u001B[39m',
    ),
  );
});

test('a format cell is measured and wrapped by its output', () => {
  const view = table<{ first: string; second: string }>({
    columns: ['first', { format: (value) => `<${value}>`, key: 'second' }],
  });
  const output = shown(view, [{ first: 'x', second: 'hello world' }], 16);
  expectFits(output, 16);
  expect(onOneLine(output, '<hello')).toBe(true);
  expect(onOneLine(output, 'world>')).toBe(true);
  expect(onOneLine(output, '<hello world>')).toBe(false);
});

test('a styled cell that wraps closes its style on each line, so no style leaks into a neighbor', () => {
  const rows = [{ first: 'x', second: 'hello world' }];
  const config = {
    columns: [
      { header: 'a', key: 'first' },
      { format: 'red', key: 'second' },
    ],
  };
  const rendering = { color: 'always', modifiers: 'never' } as const;
  const output = render({ config, rendering, rows, view: 'table', widths: [10] });
  expect(output.split('\n').slice(1)).toEqual([
    'x  \u001B[31mhello\u001B[39m',
    '   \u001B[31mworld\u001B[39m',
    '',
  ]);
});

const link = '\u001B]8;;https://example.com\u001B\\';
const unlink = '\u001B]8;;\u001B\\';

test('a hyperlink in a wrapped cell closes on each line, so it covers neither the gap nor the next column', () => {
  const rows = [{ doc: 'see the release notes', owner: 'drew' }];
  const config = { columns: [{ format: 'link', key: 'doc' }, 'owner'] };
  const rendering = { color: 'never', hyperlinks: 'always', modifiers: 'never' } as const;
  const output = render({ config, rendering, rows, view: 'table', widths: [20] });
  expect(output.split('\n').slice(1, 3)).toEqual([
    `${link}see the${unlink}${' '.repeat(6)}  drew`,
    `${link}release notes${unlink}`,
  ]);
});

test('a raw SGR color in a wrapped cell ends on each line, so it colors no neighbor', () => {
  const rows = [{ note: 'one two three', owner: 'drew' }];
  const config = { columns: [{ format: 'sgr', key: 'note' }, 'owner'] };
  const rendering = { color: 'always', modifiers: 'never' } as const;
  const output = render({ config, rendering, rows, view: 'table', widths: [12] }).split('\n');
  expect(output[1]).toBe('\u001B[31mone\u001B[39m    drew');
  expect(output[2]?.trimEnd()).toBe('\u001B[31mtwo\u001B[39m');
  expect(output[3]?.trimEnd()).toBe('\u001B[31mthree\u001B[39m');
});

test('two renders either side of a resize fit 100 and then 60', () => {
  const rows = [{ left: filler(70, 'a'), right: 'short' }];
  const config = { columns: ['left', 'right'] };
  const [wide = '', narrow = ''] = render({
    config,
    rows,
    view: 'table',
    widths: [100, 60],
  }).split('--\n');
  expect(wide).toBe(lines(`left${' '.repeat(68)}right`, `${filler(70, 'a')}  short`));
  const fitted = narrow.split('\n');
  expect(Math.max(...fitted.map((line) => line.length))).toBe(60);
  expect(fitted.join('').replaceAll(/\s+/gu, ' ')).toContain('short');
});

test('COLUMNS narrows a terminal, never widens it, fits a terminal with no width, and spares a pipe', () => {
  const rows = [{ left: filler(70, 'a'), right: 'short' }];
  const config = { columns: ['left', 'right'] };
  const widest = (width: number | 'unreported' | null, columns: string) =>
    Math.max(
      ...render({ config, env: { COLUMNS: columns }, rows, view: 'table', widths: [width] })
        .split('\n')
        .map((line) => line.length),
    );
  expect(widest(100, '60')).toBe(60);
  expect(widest(100, '150')).toBe(70 + 2 + 5);
  expect(widest('unreported', '60')).toBe(60);
  expect(widest(null, '60')).toBe(70 + 2 + 5);
});

test.each([{ invoke: false }, { invoke: true }])(
  'a table piped or invoked by name ($invoke) is byte for byte the natural width, a multi-line format cell included',
  ({ invoke }) => {
    const rows = [
      { left: 'x y z', right: 'hello world' },
      { left: 'q', right: 'zz' },
    ];
    const config = {
      columns: [
        { header: 'A', key: 'left' },
        { align: 'right', format: 'lines', key: 'right' },
      ],
    };
    const env = { COLUMNS: '10' };
    expect(render({ config, env, invoke, rows, view: 'table', widths: [null] })).toBe(
      lines(
        `A${' '.repeat(12)}right`,
        'x y z  hello world',
        'second line',
        'q               zz',
        'second line',
      ),
    );
  },
);

test('a tab in a cell expands from the start of the cell before it fits, so no line overflows', () => {
  const view = table<{ first: string; last: string }>();
  const tabs = vi.fn(expandTabs);
  const output = shown(view, [{ first: 'abcde', last: 'b\tc d' }], 16, { expandTabs: tabs });
  expect(tabs).toHaveBeenCalledWith('b\tc d');
  expectFits(output, 16);
  expect(output.join('\n')).not.toContain('\t');
  expect(onOneLine(output, `b${TAB}c`)).toBe(true);
});

/** The two SGR commands a red span writes removed, so a line measures as the terminal shows it. */
const unstyled = (text: string) => text.replaceAll('\u001B[31m', '').replaceAll('\u001B[39m', '');

/** Each line holds no tab and is at most `columns` wide, as the terminal shows it. */
function expectShownFits(output: string, columns: number): void {
  for (const line of unstyled(output).split('\n')) {
    expect(line).not.toContain('\t');
    expect(line.length).toBeLessThanOrEqual(columns);
  }
}

test('a tab in a styled cell expands inside its style', () => {
  const rows = [{ first: 'abcde', last: 'b\tc d' }];
  const config = {
    columns: [
      { header: 'f', key: 'first' },
      { format: 'red', key: 'last' },
    ],
  };
  const rendering = { color: 'always', modifiers: 'never' } as const;
  const output = render({ config, rendering, rows, view: 'table', widths: [16] });
  expectShownFits(output, 16);
  expect(output.split('\n').slice(1)).toEqual([
    'abcde  \u001B[31mb       c\u001B[39m',
    '       \u001B[31md\u001B[39m',
    '',
  ]);
});

test("a tab in a format cell's output expands as a default cell's does", () => {
  const view = table<{ first: string; last: string }>({
    columns: ['first', { format: (value) => value.toUpperCase(), key: 'last' }],
  });
  const tabs = vi.fn(expandTabs);
  const output = shown(view, [{ first: 'abcde', last: 'b\tc d' }], 18, { expandTabs: tabs });
  expect(tabs).toHaveBeenCalledWith('B\tC D');
  expect(output.join('\n')).not.toContain('\t');
});

test('a tab in a header expands as a cell does', () => {
  const view = table<{ first: string; last: string }>({
    columns: ['first', { header: 'b\tc', key: 'last' }],
  });
  const tabs = vi.fn(expandTabs);
  const output = shown(view, [{ first: 'abcde', last: 'x' }], 16, { expandTabs: tabs });
  expect(tabs).toHaveBeenCalledWith('b\tc');
  expectFits(output, 16);
  expect(output[0]).toContain(`b${TAB}c`);
});

test('a tab stays a tab in a piped table', () => {
  const view = table<{ first: string; last: string }>();
  const tabs = vi.fn(expandTabs);
  const output = shown(view, [{ first: 'abcde', last: 'b\tc d' }], undefined, { expandTabs: tabs });
  expect(tabs).not.toHaveBeenCalled();
  expect(output[1]).toContain('b\tc d');
});
