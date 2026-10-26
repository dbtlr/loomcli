// Acceptance plan: see packages/plugins/tests/list.test.ts.
import { glyph, nowrap, style } from '@loomcli/core';
import type { View, ViewContext } from '@loomcli/core';
import type { ViewValues } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

import { box } from '../src/box.js';
import { prose } from '../src/prose.js';
import { table } from '../src/table.js';
import { lines } from './fit-render.js';
import { render, run } from './pack-render.js';
import {
  TAB,
  expandTabs,
  linesOf,
  measured,
  plain,
  width,
  wordsOf,
  wrap,
} from './view-measures.js';

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
} as const;

/** A box's lines with no title around content lines already padded to one inner width. */
function framed(...content: string[]): string[] {
  const inner = content[0]?.length ?? 0;
  return [
    `╭${line.repeat(inner + 2)}╮`,
    ...content.map((text) => `│ ${text} │`),
    `╰${line.repeat(inner + 2)}╯`,
  ];
}

/** The context a box renders with, which hands its content a copy and so reads `background`. */
function boxContext(
  view: View<never>,
  columns: number | undefined,
  values: ViewValues = {},
): ViewContext {
  return measured(view, columns, { background: undefined, ...values });
}

/**
 * A box render's top border and its content lines, after checking that it is framed: rounded
 * corners, a side border on each content line, and every line one width.
 */
function frameOf(output: string): { readonly top: string; readonly inner: string[] } {
  const shown = linesOf(output);
  const top = shown[0] ?? '';
  const bottom = shown.at(-1) ?? '';
  expect(top.startsWith(plain(glyph.lineDownRightArc))).toBe(true);
  expect(top.endsWith(plain(glyph.lineDownLeftArc))).toBe(true);
  expect(bottom.startsWith(plain(glyph.lineUpRightArc))).toBe(true);
  expect(bottom.endsWith(plain(glyph.lineUpLeftArc))).toBe(true);
  const side = plain(glyph.lineVertical);
  const inner = shown.slice(1, -1).map((each) => {
    expect(each.startsWith(`${side} `)).toBe(true);
    expect(each.endsWith(` ${side}`)).toBe(true);
    return each.slice(2, -2).trimEnd();
  });
  expect(new Set(shown.map(width)).size).toBe(1);
  return { inner, top };
}

/** A content view that hands the box's context to `content` and keeps the columns it was given. */
function watching<Data>(content: View<Data>): {
  readonly view: View<Data>;
  readonly seen: (number | undefined)[];
} {
  const seen: (number | undefined)[] = [];
  return {
    seen,
    view: {
      render: (data, context) => {
        seen.push(context.columns);
        return content.render(data, context);
      },
    },
  };
}

test.each([60, undefined])(
  'a text box with a title frames its text, with its borders dim and its title primary and bold, at %s columns',
  (columns) => {
    const view = box({ title: 'Totals' });
    const context = boxContext(view, columns);
    const bold = vi.spyOn(context.style.primary, 'bold');
    const dim = vi.spyOn(context.style, 'dim');
    const { inner, top } = frameOf(view.render(passed, context));
    expect(top).toContain(' Totals ');
    expect(inner).toEqual([passed]);
    expect(bold).toHaveBeenCalledWith('Totals');
    expect(dim).toHaveBeenCalledWith(glyph.lineVertical);
  },
);

test.each([60, undefined])(
  'a text box without a title frames its text, at %s columns',
  (columns) => {
    const view = box();
    const { inner, top } = frameOf(view.render(passed, boxContext(view, columns)));
    expect(wordsOf(top)).toHaveLength(1);
    expect(inner).toEqual([passed]);
  },
);

test('box() renders as the default view of a declared string result', () => {
  const config = { title: 'Result' };
  expect(
    render({ config, data: 'All checks passed.', declared: true, view: 'box', widths: [40] }),
  ).toBe(lines('╭─ Result ───────────╮', '│ All checks passed. │', '╰────────────────────╯'));
});

test('a title wider than the text widens the box to hold the title and a line after it', () => {
  const view = box({ title: 'Result summary' });
  const { inner, top } = frameOf(view.render('ok', boxContext(view, 40)));
  expect(top).toContain(` Result summary ${line}`);
  expect(inner).toEqual(['ok']);
});

test('a text box wraps its text at columns minus 4', () => {
  const view = box();
  const wraps = vi.fn(wrap);
  const { inner } = frameOf(view.render(passed, boxContext(view, 30, { wrap: wraps })));
  expect(wraps).toHaveBeenCalledWith(passed, 26);
  expect(inner.length).toBeGreaterThan(1);
  expect(inner.join(' ')).toBe(passed);
});

test.each([60, undefined])('a box frames a table, at %s columns', (columns) => {
  const view = box({ content: table<Record<string, unknown>>(), title: 'Pools' });
  const { inner, top } = frameOf(view.render(pools, boxContext(view, columns)));
  expect(top).toContain(' Pools ');
  expect(inner.map(wordsOf)).toEqual([
    ['pool', 'instances', 'status'],
    ['blue', '4', 'ready'],
    ['green', '4', 'warming'],
  ]);
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

test('a framed table renders at the columns the box leaves it, and shrinks to fit them', () => {
  const content = watching(table<(typeof tasks)[number]>(taskColumns));
  const view = box({ content: content.view, title: 'Tasks' });
  const output = view.render(tasks, boxContext(view, 26));
  const { inner } = frameOf(output);
  expect(content.seen).toEqual([22]);
  expect(Math.max(...linesOf(output).map(width))).toBeLessThanOrEqual(26);
  expect(inner.some((each) => each.includes('compiles everything'))).toBe(false);
  expect(wordsOf(inner.join('\n'))).toEqual(
    expect.arrayContaining([
      'NAME',
      'NOTE',
      'build',
      'compiles',
      'everything',
      'lint',
      'checks',
      'style',
    ]),
  );
});

test('a framed table falls back to records when its floors do not fit inside the box', () => {
  const view = box({ content: table<(typeof tasks)[number]>(taskColumns) });
  const { inner } = frameOf(view.render(tasks, boxContext(view, 20)));
  expect(inner.some((each) => each.includes('NAME') && each.includes('NOTE'))).toBe(false);
  expect(inner.filter((each) => each.startsWith('NAME'))).toHaveLength(2);
  expect(inner.filter((each) => each.startsWith('NOTE'))).toHaveLength(2);
  expect(wordsOf(inner.join('\n'))).toEqual(
    expect.arrayContaining(['build', 'compiles', 'everything', 'lint', 'checks', 'style']),
  );
});

test('a content view that ignores columns widens the box past them', () => {
  const wide: View<string> = { render: () => `${'w'.repeat(50)}\n` };
  const view = box({ content: wide });
  const output = view.render('', boxContext(view, 30));
  const { inner } = frameOf(output);
  expect(inner).toEqual(['w'.repeat(50)]);
  expect(width(linesOf(output)[0] ?? '')).toBeGreaterThan(30);
});

test('a declared view override does not apply inside a box', () => {
  const data = [{ pool: 'blue' }];
  expect(render({ config: { content: 'declared' }, data, view: 'box', widths: [null] })).toBe(
    lines('override', ...framed('pool', 'blue')),
  );
});

test("a tab in piped content is left to each line's padding, so the box expands no tab off a terminal", () => {
  const view = box();
  const tabs = vi.fn(expandTabs);
  const output = view.render('a\tb\nabcdefghij', boxContext(view, undefined, { expandTabs: tabs }));
  const { inner } = frameOf(output);
  expect(tabs).not.toHaveBeenCalled();
  expect(inner).toEqual(['a\tb', 'abcdefghij']);
});

test('a tab in text content expands on a terminal before the box measures it', () => {
  const view = box();
  const tabs = vi.fn(expandTabs);
  const { inner } = frameOf(view.render('a\tb', boxContext(view, 30, { expandTabs: tabs })));
  expect(tabs).toHaveBeenCalledWith('a\tb');
  expect(inner).toEqual([`a${TAB}b`]);
});

test.each([30, undefined])(
  'a text box over the empty string and a box whose content renders nothing print nothing, at %s columns',
  (columns) => {
    const text = box();
    expect(text.render('', boxContext(text, columns))).toBe('');
    const rows = box({ content: table<Record<string, unknown>>() });
    expect(rows.render([], boxContext(rows, columns))).toBe('');
  },
);

test.each([
  ['a style frame', style.red('')],
  ['a nowrap frame', nowrap('')],
])(
  'a text box over %s around nothing, which resolves to no character, prints nothing',
  (_name, data) => {
    const view = box();
    expect(view.render(data, boxContext(view, 30))).toBe('');
    expect(view.render(data, boxContext(view, undefined))).toBe('');
  },
);

test.each([{}, { title: 'Result' }])(
  'a box whose content renders a text that resolves to no character prints nothing: %o',
  (config) => {
    const view = box({ content: prose(), ...config });
    expect(view.render(style.red(''), boxContext(view, 30))).toBe('');
    expect(view.render(style.red(''), boxContext(view, undefined))).toBe('');
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
