import { expect, test } from 'vite-plus/test';

import { levelWidths } from '../src/table-fit.js';
import { filler, lines, render } from './fit-render.js';

const noteRows = [
  { name: 'build', note: 'compiles every package and bundles the examples' },
  { name: 'check', note: 'runs the formatter, the linter, and the type checker' },
];
const noteColumns = {
  columns: [
    { header: 'NAME', key: 'name' },
    { header: 'NOTE', key: 'note' },
  ],
};

test('a table that fits prints its natural width, exactly at the limit or under it', () => {
  const rows = [{ name: 'build', note: 'compiles' }];
  const expected = lines('name   note', 'build  compiles');
  const config = { columns: ['name', 'note'] };
  for (const width of [15, 40, null, 'unreported'] as const) {
    expect(render({ config, rows, view: 'table', widths: [width] })).toBe(expected);
  }
});

test('a table one column too wide shrinks and wraps every value whole', () => {
  expect(render({ config: noteColumns, rows: noteRows, view: 'table', widths: [30] })).toBe(
    lines(
      'NAME   NOTE',
      'build  compiles every package',
      '       and bundles the',
      '       examples',
      'check  runs the formatter, the',
      '       linter, and the type',
      '       checker',
    ),
  );
});

/** The three-column table whose natural widths are 40, 20, and 6, the last right-aligned. */
const levelled = {
  config: {
    columns: [
      { header: 'A', key: 'wide' },
      { header: 'B', key: 'middle' },
      { align: 'right', header: 'C', key: 'narrow' },
    ],
  },
  rows: [{ middle: filler(20, 'b'), narrow: 'cccccc', wide: filler(40, 'a') }],
  view: 'table',
} as const;

test.each([
  { cells: 46, widths: [20, 20, 6] },
  { cells: 40, widths: [17, 17, 6] },
  { cells: 39, widths: [17, 16, 6] },
])(
  'levelling from the top gives $widths with $cells columns for cells, and totals the width',
  ({ cells, widths }) => {
    const columns = cells + 4;
    const output = render({ ...levelled, widths: [columns] }).split('\n');
    const [first = 0, second = 0] = widths;
    const header = output[0] ?? '';
    expect(header.indexOf('B')).toBe(first + 2);
    // C is right-aligned in its 6 columns, so it lands on the last one.
    expect(header.indexOf('C')).toBe(first + 2 + second + 2 + 5);
    expect(Math.max(...output.map((line) => line.length))).toBe(columns);
    const wide = output.slice(1, -1).map((line) => line.slice(0, first).trim());
    expect(wide.join(' ')).toBe(filler(40, 'a'));
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
  const text = filler(30, 'x');
  const rows = [{ left: text, middle: text, right: text }];
  const config = { columns: ['left', 'middle', 'right'] };
  const header = render({ config, rows, view: 'table', widths: [84] }).split('\n')[0] ?? '';
  expect(header.indexOf('middle')).toBe(27 + 2);
  expect(header.indexOf('right')).toBe(27 + 2 + 27 + 2);
});

test('a column held at its floor by a long word stays there while the others narrow', () => {
  const rows = [{ tail: filler(40, 't'), word: 'abcdefghijklmnopqrst uv' }];
  const config = { columns: ['word', 'tail'] };
  const output = render({ config, rows, view: 'table', widths: [40] });
  expect(output.split('\n').slice(1, 3)).toEqual([
    `abcdefghijklmnopqrst  ${filler(40, 't').slice(0, 14)}`,
    `uv${' '.repeat(20)}${filler(40, 't').slice(15, 29)}`,
  ]);
});

test('a cell whose trailing space would overflow its column wraps, so every line fits and columns align', () => {
  const rows = [
    { name: 'Ada Lovelace ', role: 'math' },
    { name: 'Bo', role: 'ops' },
  ];
  const output = render({ config: {}, rows, view: 'table', widths: [18] }).split('\n');
  expect(Math.max(...output.map((line) => line.length))).toBeLessThanOrEqual(18);
  // The name column levels to 12, so the role column starts at 14 on every line it has text.
  expect(output[0]?.indexOf('role')).toBe(14);
  expect(output[1]).toBe(`Ada${' '.repeat(11)}math`);
  expect(output[2]?.trimEnd()).toBe('Lovelace');
  expect(output[3]).toBe(`Bo${' '.repeat(12)}ops`);
});

/*
 * The floor of the word column is 10, the whole of `abcd      `, because an input line's trailing
 * spaces stay with its last word. With the tail column's floor of 4 and the gap, the floors need
 * 16 columns, more than 12, so the rows print as records blocks instead of a shrunk table.
 */
test('a word with trailing spaces is one unit at its full width, so its floor can force the fallback', () => {
  const rows = [
    { tail: 'efgh', word: 'abcd      ' },
    { tail: 'kl', word: 'ij' },
  ];
  const config = { columns: ['word', 'tail'] };
  expect(render({ config, rows, view: 'table', widths: [12] })).toBe(
    lines('word  abcd      ', 'tail  efgh', '', 'word  ij', 'tail  kl'),
  );
});

test('a nowrap cell raises its column floor to the whole cell', () => {
  const rows = [{ note: filler(40, 'n'), path: 'a b c d e f' }];
  const config = {
    columns: [{ format: 'nowrap', header: 'P', key: 'path' }, 'note'],
  };
  const output = render({ config, rows, view: 'table', widths: [30] }).split('\n');
  expect(output[1]).toBe(`a b c d e f  ${filler(40, 'n').slice(0, 14)}`);
});

test.each([
  {
    align: 'right',
    expected: lines('     N  note', ' aaa b  x', '    cc', '  dddd'),
  },
  {
    align: 'center',
    expected: lines('  N     note', 'aaa b   x', '  cc', ' dddd'),
  },
])('each line of a wrapped $align cell keeps the column alignment', ({ align, expected }) => {
  const rows = [{ note: 'x', text: 'aaa b cc dddd' }];
  const config = { columns: [{ align, header: 'N', key: 'text' }, 'note'] };
  expect(render({ config, rows, view: 'table', widths: [12] })).toBe(expected);
});

test('a line ends at its rightmost cell with text, which carries no padding, and an earlier shorter cell pads blank lines', () => {
  const rows = [{ long: 'one two three', short: 'x' }];
  const long = { header: 'L', key: 'long' };
  const short = { header: 'S', key: 'short' };
  expect(render({ config: { columns: [long, short] }, rows, view: 'table', widths: [10] })).toBe(
    lines('L        S', 'one two  x', 'three'),
  );
  expect(render({ config: { columns: [short, long] }, rows, view: 'table', widths: [10] })).toBe(
    lines('S  L', 'x  one two', '   three'),
  );
});

test('a middle cell taller than the last ends its extra lines at its own text, with no gap or padding after', () => {
  const rows = [{ first: 'x', last: 'z', middle: 'one two three' }];
  const config = {
    columns: [
      { header: 'a', key: 'first' },
      { header: 'b', key: 'middle' },
      { header: 'c', key: 'last' },
    ],
  };
  const output = render({ config, rows, view: 'table', widths: [14] });
  expect(output).toBe(lines('a  b         c', 'x  one two   z', '   three'));
  for (const line of output.split('\n')) {
    expect(line).toBe(line.trimEnd());
  }
});

test('a header wider than its cells sets the natural width and wraps like a cell', () => {
  const rows = [{ small: 'x', text: filler(30, 'b') }];
  const config = { columns: [{ header: 'ENORMOUS HEADER', key: 'small' }, 'text'] };
  expect(
    render({ config, rows, view: 'table', widths: [30] })
      .split('\n')
      .slice(0, 3),
  ).toEqual(['ENORMOUS        text', 'HEADER', `x               ${filler(30, 'b').slice(0, 14)}`]);
});

test('a header word longer than every cell word sets the floor', () => {
  const rows = [{ small: 'x y', text: filler(40, 'b') }];
  const config = { columns: [{ header: 'SUPERCALIFRAGILISTIC', key: 'small' }, 'text'] };
  const output = render({ config, rows, view: 'table', widths: [30] }).split('\n');
  expect(output[0]).toBe('SUPERCALIFRAGILISTIC  text');
});

test('an empty sequence prints its header line at the fitted widths', () => {
  const config = {
    columns: [
      { header: 'FIRST NAME', key: 'first' },
      { header: 'LAST NAME', key: 'last' },
    ],
  };
  expect(render({ config, rows: [], view: 'table', widths: [12] })).toBe(
    lines('FIRST  LAST', 'NAME   NAME'),
  );
  expect(render({ config, rows: [], view: 'table', widths: [40] })).toBe(
    lines('FIRST NAME  LAST NAME'),
  );
});

test('an empty sequence overflows at its floors rather than taking the records fallback', () => {
  const config = { columns: ['ALPHA', 'BETA'] };
  expect(render({ config, rows: [], view: 'table', widths: [5] })).toBe(lines('ALPHA  BETA'));
});

test('an empty sequence with no columns list prints nothing', () => {
  expect(render({ config: {}, rows: [], view: 'table', widths: [30] })).toBe('');
});

test('a table whose floors do not fit renders as records blocks', () => {
  const rows = [
    { name: 'abcdefghijkl', note: 'one two three four five' },
    { name: 'second', note: 'tail' },
  ];
  expect(render({ config: noteColumns, rows, view: 'table', widths: [15] })).toBe(
    lines(
      'NAME  abcdefghijkl',
      'NOTE  one two',
      '      three',
      '      four five',
      '',
      'NAME  second',
      'NOTE  tail',
    ),
  );
});

test('the records fallback aligns a value within its own widest wrapped line', () => {
  const rows = [{ text: 'aaa b cc dddd', wide: 'zzzzzzzzzzzzzzz' }];
  const labelled = (align: 'center' | 'right') =>
    render({
      config: { columns: [{ align, key: 'text' }, 'wide'] },
      rows,
      view: 'table',
      widths: [12],
    });
  expect(labelled('right')).toBe(
    lines('text  aaa b', '         cc', '       dddd', 'wide  zzzzzzzzzzzzzzz'),
  );
  expect(labelled('center')).toBe(
    lines('text  aaa b', '       cc', '      dddd', 'wide  zzzzzzzzzzzzzzz'),
  );
});

test('a format cell is measured and wrapped by its output', () => {
  const rows = [{ first: 'x', second: 'hello world' }];
  const config = { columns: ['first', { format: 'red', key: 'second' }] };
  expect(render({ config, rows, view: 'table', widths: [16] })).toBe(
    lines('first  second', 'x      hello', '       world'),
  );
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

test('a piped table is byte for byte the natural width, a multi-line format cell included', () => {
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
  expect(render({ config, env: { COLUMNS: '10' }, rows, view: 'table', widths: [null] })).toBe(
    lines(
      `A${' '.repeat(12)}right`,
      'x y z  hello world',
      'second line',
      'q               zz',
      'second line',
    ),
  );
});
