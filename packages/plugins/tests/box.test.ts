import { expect, test } from 'vite-plus/test';

import { lines } from './fit-render.js';
import { render, run } from './pack-render.js';

const line = '─';
const passed = 'All three services passed their health checks.';
// The table discovers its columns in first-seen key order, which an object literal would sort.
const pools = [
  Object.fromEntries([
    ['pool', 'blue'],
    ['instances', 4],
    ['status', 'ready'],
  ]),
  Object.fromEntries([
    ['pool', 'green'],
    ['instances', 4],
    ['status', 'warming'],
  ]),
];
const tasks = [
  { name: 'build', note: 'compiles everything' },
  { name: 'lint', note: 'checks style' },
];
const taskColumns = {
  columns: [
    { header: 'NAME', key: 'name' },
    { header: 'NOTE', key: 'note' },
  ],
};

/** A box's lines with no title around content lines already padded to one inner width. */
function framed(...content: string[]): string[] {
  const inner = content[0]?.length ?? 0;
  return [
    `╭${line.repeat(inner + 2)}╮`,
    ...content.map((text) => `│ ${text} │`),
    `╰${line.repeat(inner + 2)}╯`,
  ];
}

test.each([60, null])('a text box with a title frames its text, at %s columns', (width) => {
  expect(render({ config: { title: 'Totals' }, data: passed, view: 'box', widths: [width] })).toBe(
    lines(
      '╭─ Totals ───────────────────────────────────────╮',
      '│ All three services passed their health checks. │',
      '╰────────────────────────────────────────────────╯',
    ),
  );
});

test.each([60, null])('a text box without a title frames its text, at %s columns', (width) => {
  expect(render({ data: passed, view: 'box', widths: [width] })).toBe(lines(...framed(passed)));
});

test('box() renders as the default view of a declared string result', () => {
  const config = { title: 'Result' };
  expect(
    render({ config, data: 'All checks passed.', declared: true, view: 'box', widths: [40] }),
  ).toBe(lines('╭─ Result ───────────╮', '│ All checks passed. │', '╰────────────────────╯'));
});

test('a title wider than the text sets the inner width', () => {
  expect(
    render({ config: { title: 'Result summary' }, data: 'ok', view: 'box', widths: [40] }),
  ).toBe(lines(`╭─ Result summary ${line}╮`, `│ ok${' '.repeat(14)} │`, `╰${line.repeat(18)}╯`));
});

test('a text box wraps its text at columns minus 4', () => {
  expect(render({ data: passed, view: 'box', widths: [30] })).toBe(
    lines(...framed('All three services passed', 'their health checks.     ')),
  );
});

test.each([60, null])('a box frames a table, at %s columns', (width) => {
  const config = { content: { table: {} }, title: 'Pools' };
  expect(render({ config, data: pools, view: 'box', widths: [width] })).toBe(
    lines(
      '╭─ Pools ───────────────────╮',
      '│ pool   instances  status  │',
      '│ blue   4          ready   │',
      '│ green  4          warming │',
      '╰───────────────────────────╯',
    ),
  );
});

test('a boxed table renders as the default view of a declared rows result', () => {
  const config = { content: { table: {} }, title: 'Pools' };
  expect(render({ config, data: pools, declared: true, view: 'box', widths: [60] })).toBe(
    lines(
      '╭─ Pools ───────────────────╮',
      '│ pool   instances  status  │',
      '│ blue   4          ready   │',
      '│ green  4          warming │',
      '╰───────────────────────────╯',
    ),
  );
});

test('a framed table shrinks to the columns the box leaves it', () => {
  const config = { content: { table: taskColumns }, title: 'Tasks' };
  expect(render({ config, data: tasks, view: 'box', widths: [26] })).toBe(
    lines(
      `╭─ Tasks ${line.repeat(13)}╮`,
      '│ NAME   NOTE         │',
      '│ build  compiles     │',
      '│        everything   │',
      '│ lint   checks style │',
      `╰${line.repeat(21)}╯`,
    ),
  );
});

test('a framed table falls back to records when its floors do not fit inside the box', () => {
  const config = { content: { table: taskColumns } };
  expect(render({ config, data: tasks, view: 'box', widths: [20] })).toBe(
    lines(
      ...framed(
        'NAME  build     ',
        'NOTE  compiles  ',
        '      everything',
        '                ',
        'NAME  lint      ',
        'NOTE  checks    ',
        '      style     ',
      ),
    ),
  );
});

test('a content view that ignores columns widens the box past them', () => {
  expect(render({ config: { content: 'wide' }, data: '', view: 'box', widths: [30] })).toBe(
    lines(...framed('w'.repeat(50))),
  );
});

test('a declared view override does not apply inside a box', () => {
  const data = [{ pool: 'blue' }];
  expect(render({ config: { content: 'declared' }, data, view: 'box', widths: [null] })).toBe(
    lines('override', ...framed('pool', 'blue')),
  );
});

test('a tab in piped content keeps the right border in its column', () => {
  expect(render({ data: 'a\tb\nabcdefghij', view: 'box', widths: [null] })).toBe(
    lines(...framed('a       b ', 'abcdefghij')),
  );
});

test('a tab in text content expands on a terminal before the box measures it', () => {
  expect(render({ data: 'a\tb', view: 'box', widths: [30] })).toBe(lines(...framed('a       b')));
});

test('a text box over the empty string and a box whose content renders nothing print nothing', () => {
  expect(render({ data: '', view: 'box', widths: [30, null] })).toBe(lines('--'));
  const config = { content: { table: {} } };
  expect(render({ config, data: [], view: 'box', widths: [30, null] })).toBe(lines('--'));
});

test.each(['@@red-empty@@', '@@nowrap-empty@@'])(
  'a text box over %s, which resolves to no character, prints nothing',
  (data) => {
    expect(render({ data, view: 'box', widths: [30, null] })).toBe(lines('--'));
  },
);

test.each([{ content: 'prose' }, { content: 'prose', title: 'Result' }])(
  'a box whose content renders a text that resolves to no character prints nothing: %o',
  (config) => {
    expect(render({ config, data: '@@red-empty@@', view: 'box', widths: [30, null] })).toBe(
      lines('--'),
    );
  },
);

test('a text box over a value that is not a string fails the run the ordinary way', () => {
  const input = {
    config: { title: 'Value' },
    data: 5,
    declared: true,
    view: 'box',
    widths: [40],
  } as const;
  expect(run(input)).toEqual({
    status: 1,
    stderr: 'pack-views: Something went wrong.\n',
    stdout: '',
  });
  expect(run({ ...input, build: 'development' }).stderr).toContain(
    '\n\nStyle helpers require a string.\n',
  );
});

test('a box styles its borders dim and its title primary and bold', () => {
  const rendering = { color: 'always', modifiers: 'always' } as const;
  const config = { title: 'T' };
  expect(render({ config, data: 'Hi', rendering, theme: true, view: 'box', widths: [40] })).toBe(
    [
      '\u001B[90m╭─ \u001B[36;1mT\u001B[90;22m ─╮\u001B[39m',
      '\u001B[90m│\u001B[39m Hi  \u001B[90m│\u001B[39m',
      '\u001B[90m╰─────╯\u001B[39m',
      '',
    ].join('\n'),
  );
});
