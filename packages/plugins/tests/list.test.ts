/*
 * Acceptance plan for the list, heading, rule, prose, and box views (docs/plugins/pack-views.md#list).
 *
 * Each case runs under Node and Bun. A case about one view at a width calls the view through
 * viewContext, at a terminal width and with `columns` undefined, with the simple measures of
 * view-measures.ts, and checks the branch the view took and the content it printed, not its layout.
 * A case about the run around a view, a declared result, the theme, an invocation by name, build
 * mode, or a declared override, renders in a child process and checks exact bytes, and
 * pack-fit.test.ts checks once per view that a real render fits a narrow terminal. The acceptance
 * tests cover:
 *
 * - Each factory twice. Each view as the second argument of `out.render`, and the list and the text
 *   views as entries of a declared result under `rows<Item>` and `result<string>()`.
 * - The list. Bullets and ordered markers, ordered markers right-aligned from ` 9.` to `10.`,
 *   `null` and `undefined` items printing empty, a default item escaped beside a `format` item left
 *   unescaped, `format` receiving each item's index among its siblings, two levels of `children`
 *   with each level starting at its parent's text column and a nested ordered list counting from 1,
 *   a wrapped item hanging under its text at 30 columns, an authored line break hanging under its
 *   text piped, a blank line inside an item carrying no indent, a tab expanding on a terminal and
 *   kept piped, and an empty sequence printing nothing.
 * - The heading. Level 1 and level 2, a level 1 underline as wide as a CJK text and as a styled
 *   text, a wrapped level 1 underline matching its widest wrapped line, and a word wider than
 *   `columns` keeping its line and widening its underline.
 * - The rule. A bare and a labelled rule at 60 columns and piped at 80, a label wrapped at a narrow
 *   width with its continuation lines under the label and the line on its last line alone, a blank
 *   label line printing empty and a blank last label line carrying the line after it, and a label
 *   word too wide to fit overflowing with one `glyph.line` after it.
 * - Prose. Paragraphs separated by a blank line, a leading indent kept on the first line, a tab
 *   expanding on a terminal and kept piped, a text with and without a trailing line break, and an
 *   OSC 8 hyperlink closing at each wrapped line's end.
 * - The box. A text box with and without a title, a title wider than its text setting the inner
 *   width, text wrapped at `columns` minus 4, a table framed at a width where it shrinks and at one
 *   where it falls back to records, a content view that ignores `columns` widening the box, a
 *   declared view's override not applying inside a box, a tab in piped content keeping the right
 *   border in its column, and the empty string printing nothing.
 * - Empty text. Under each view over a string, the empty string, a style frame around nothing such
 *   as `style.dim('')`, and a `nowrap` frame around nothing each render the empty string, on a
 *   terminal and piped, except that the rule draws its bare line, a box with a title over such a
 *   text prints nothing, and a box whose `content` view renders such a text prints nothing, titled
 *   and untitled.
 * - A resize. Under a pty-backed host, one run renders a rule and a box at 100 columns, the window
 *   resizes to 60, and the next rule and box fit 60.
 * - Typing. The negative type checks cover a list `format` whose item parameter is not `Item`, a
 *   `children` that returns another type, a heading `level` of 3, a box with no `content` under
 *   `result<Summary>()`, and a column the row does not carry inside a boxed table.
 */

import { glyph } from '@loomcli/core';
import { expect, test, vi } from 'vite-plus/test';

import { list } from '../src/list.js';
import { renderEach, renderRows } from './fixtures/view-run.ts';
import { TAB, expandTabs, indentOf, linesOf, measured, plain, width } from './view-measures.js';

interface Service {
  readonly name: string;
  readonly parts?: readonly Service[];
}

const services: readonly Service[] = [
  { name: 'api-gateway' },
  { name: 'billing', parts: [{ name: 'invoices' }, { name: 'refunds' }] },
  { name: 'search' },
];

/** The bullet as a render shows it. */
const bullet = plain(glyph.bullet);

/** A list of services by name, each with its parts nested under it. */
const named = (ordered = false) =>
  list<Service>({ children: (item) => item.parts, format: (item) => item.name, ordered });

test.each([40, undefined])(
  'list() bullets each item with its nested items indented past their parent marker, at %s columns',
  (columns) => {
    const view = named();
    const context = measured(view, columns);
    const dim = vi.spyOn(context.style, 'dim');
    const shown = linesOf(view.render(services, context));
    expect(shown.map((each) => each.trim())).toEqual(
      ['api-gateway', 'billing', 'invoices', 'refunds', 'search'].map(
        (name) => `${bullet} ${name}`,
      ),
    );
    const [gateway = '', billing = '', invoices = '', refunds = '', search = ''] = shown;
    expect([gateway, billing, search].map(indentOf)).toEqual([0, 0, 0]);
    expect(indentOf(invoices)).toBe(billing.indexOf('billing'));
    expect(indentOf(refunds)).toBe(indentOf(invoices));
    expect(dim).toHaveBeenCalledTimes(5);
  },
);

test('list() renders as the default view of a declared rows result', async () => {
  const run = { widths: [40] };
  const data = ['one', 'two'];
  await expect(renderRows(run, data, { view: list<string>() })).resolves.toBe(
    await renderEach(run, (out) => out.render(data, list<string>())),
  );
});

test('an ordered list numbers its items from 1. to 10. and right-aligns the markers, so every text starts in one column', () => {
  const view = list<string>({ ordered: true });
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const shown = linesOf(view.render(items, measured(view, 40)));
  expect(shown.map((each) => each.trim())).toEqual(
    items.map((item, index) => `${String(index + 1)}. ${item}`),
  );
  expect(new Set(shown.map((each, index) => each.indexOf(items[index] ?? ''))).size).toBe(1);
});

test('two levels of children nest under their parents, and a nested ordered list counts from 1', () => {
  const data: Service[] = [
    ...['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'].map((name) => ({ name })),
    { name: 's10', parts: [{ name: 'a' }, { name: 'b', parts: [{ name: 'c' }] }] },
  ];
  const view = named(true);
  const shown = linesOf(view.render(data, measured(view, 40))).slice(9);
  expect(shown.map((each) => each.trim())).toEqual(['10. s10', '1. a', '2. b', '1. c']);
  const [parent = 0, first = 0, second = 0, deeper = 0] = shown.map(indentOf);
  expect(parent).toBe(0);
  expect(first).toBe(shown[0]?.indexOf('s10'));
  expect(second).toBe(first);
  expect(deeper).toBe(shown[2]?.lastIndexOf('b'));
});

test.each([40, undefined])(
  'null and undefined items print their marker alone, at %s columns',
  (columns) => {
    const data = [null, 'x', undefined];
    const bullets = list<string | null | undefined>();
    expect(linesOf(bullets.render(data, measured(bullets, columns)))).toEqual([
      bullet,
      `${bullet} x`,
      bullet,
    ]);
    const numbers = list<string | null | undefined>({ ordered: true });
    expect(linesOf(numbers.render(data, measured(numbers, columns)))).toEqual(['1.', '2. x', '3.']);
  },
);

test('a default item is escaped and styled primary, while a format item is the author text as written', () => {
  const marker = '["style",[["foreground","red"]]]data';
  const plainItems = list<string>();
  const context = measured(plainItems, undefined);
  const escape = vi.spyOn(context.style, 'escape');
  const primary = vi.spyOn(context.style, 'primary');
  plainItems.render([marker], context);
  expect(escape).toHaveBeenCalledWith(marker);
  expect(primary).toHaveBeenCalledWith(marker);
  const formatted = list<string>({ format: (item) => item });
  const authored = measured(formatted, undefined);
  const unescaped = vi.spyOn(authored.style, 'escape');
  expect(linesOf(formatted.render([marker], authored))).toEqual([`${bullet} data`]);
  expect(unescaped).not.toHaveBeenCalled();
});

test('format receives each item index among its siblings', () => {
  const format = vi.fn((item: Service, _index: number) => item.name);
  const view = list<Service>({ children: (item) => item.parts, format });
  view.render(services, measured(view, 40));
  expect(format.mock.calls.map(([item, index]) => `${String(index)}:${item.name}`)).toEqual([
    '0:api-gateway',
    '1:billing',
    '0:invoices',
    '1:refunds',
    '2:search',
  ]);
});

test('a wrapped item hangs its later lines under its text, and every line fits', () => {
  const view = list<string>();
  const item = 'refunds, whose retry policy lands with this deploy';
  const [first = '', ...rest] = linesOf(view.render([item], measured(view, 30)));
  expect(first.startsWith(`${bullet} refunds,`)).toBe(true);
  expect(rest.length).toBeGreaterThan(0);
  for (const each of [first, ...rest]) {
    expect(width(each)).toBeLessThanOrEqual(30);
  }
  for (const each of rest) {
    expect(indentOf(each)).toBe(first.indexOf('refunds'));
  }
  expect([first.slice(2), ...rest.map((each) => each.trim())].join(' ')).toBe(item);
});

test('a nested item wraps at the columns left after its own text column, so every line fits', () => {
  const data = [{ name: 'billing', parts: [{ name: 'refunds, whose retry policy lands' }] }];
  const view = named(true);
  const shown = linesOf(view.render(data, measured(view, 24)));
  expect(shown.length).toBeGreaterThan(2);
  for (const each of shown) {
    expect(width(each)).toBeLessThanOrEqual(24);
  }
  expect(
    shown
      .slice(1)
      .map((each) => each.trim())
      .join(' '),
  ).toBe('1. refunds, whose retry policy lands');
  expect(indentOf(shown[2] ?? '')).toBe(shown[1]?.indexOf('refunds'));
});

test('an authored line break hangs under its text when piped', () => {
  const view = list<string>();
  const [first = '', second = '', ...rest] = linesOf(
    view.render(['first line\nsecond line'], measured(view, undefined)),
  );
  expect(rest).toEqual([]);
  expect(first).toBe(`${bullet} first line`);
  expect(second.trim()).toBe('second line');
  expect(indentOf(second)).toBe(first.indexOf('first'));
});

test.each([30, undefined])(
  'a blank line inside an item carries no indent, at %s columns',
  (columns) => {
    const view = list<string>();
    const shown = linesOf(view.render(['above\n\nbelow'], measured(view, columns)));
    expect(shown).toHaveLength(3);
    expect(shown[1]).toBe('');
  },
);

test('a tab in an item expands on a terminal and is kept when piped', () => {
  const view = list<string>();
  const tabs = vi.fn(expandTabs);
  expect(linesOf(view.render(['a\tb'], measured(view, 30, { expandTabs: tabs })))).toEqual([
    `${bullet} a${TAB}b`,
  ]);
  expect(tabs).toHaveBeenCalledWith('a\tb');
  expect(linesOf(view.render(['a\tb'], measured(view, undefined)))).toEqual([`${bullet} a\tb`]);
});

test('a list styles its markers dim and a default item primary', async () => {
  const rendering = { color: 'always', modifiers: 'always' } as const;
  const run = { rendering, theme: true, widths: [40] };
  await expect(
    renderEach(run, (out) => out.render(['a', null], list<string | null>())),
  ).resolves.toBe('\u001B[90m●\u001B[39m \u001B[36ma\u001B[39m\n\u001B[90m●\u001B[39m\n');
  await expect(
    renderEach(run, (out) => out.render(['a'], list<string>({ ordered: true }))),
  ).resolves.toBe('\u001B[90m1.\u001B[39m \u001B[36ma\u001B[39m\n');
});

test('an empty sequence prints nothing, on a terminal and piped', () => {
  const view = list<string>();
  expect(view.render([], measured(view, 30))).toBe('');
  expect(view.render([], measured(view, undefined))).toBe('');
});
