/*
 * Acceptance plan for the list, heading, rule, prose, and box views (docs/plugins/pack-views.md#list).
 *
 * Each case runs under Node and Bun, at a fixed width through a handle's terminal of plain numbers and
 * with `columns` undefined, and checks exact bytes. The acceptance tests cover:
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

import { expect, test } from 'vite-plus/test';

import { lines } from './fit-render.js';
import { render } from './pack-render.js';

const services = [
  { name: 'api-gateway' },
  { name: 'billing', parts: [{ name: 'invoices' }, { name: 'refunds' }] },
  { name: 'search' },
];

test.each([40, null])(
  'list() prints bullets with nested items at their parent text column, at %s columns',
  (width) => {
    const config = { children: true, format: 'name' };
    expect(render({ config, data: services, view: 'list', widths: [width] })).toBe(
      lines('● api-gateway', '● billing', '  ● invoices', '  ● refunds', '● search'),
    );
  },
);

test('list() renders as the default view of a declared rows result', () => {
  expect(render({ data: ['one', 'two'], declared: true, view: 'list', widths: [40] })).toBe(
    lines('● one', '● two'),
  );
});

test('an ordered list right-aligns its markers from 9. to 10.', () => {
  const data = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const output = render({ config: { ordered: true }, data, view: 'list', widths: [40] });
  expect(output).toBe(
    lines(' 1. a', ' 2. b', ' 3. c', ' 4. d', ' 5. e', ' 6. f', ' 7. g', ' 8. h', ' 9. i', '10. j'),
  );
});

test('two levels of children start at their parent text column, and a nested ordered list counts from 1', () => {
  const data = [
    ...['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'].map((name) => ({ name })),
    { name: 's10', parts: [{ name: 'a' }, { name: 'b', parts: [{ name: 'c' }] }] },
  ];
  const config = { children: true, format: 'name', ordered: true };
  const output = render({ config, data, view: 'list', widths: [40] }).split('\n');
  expect(output.slice(8)).toEqual([' 9. s9', '10. s10', '    1. a', '    2. b', '       1. c', '']);
});

test.each([40, null])(
  'null and undefined items print their marker alone, at %s columns',
  (width) => {
    const data = [null, 'x', '@@undefined@@'];
    expect(render({ data, view: 'list', widths: [width] })).toBe(lines('●', '● x', '●'));
    expect(render({ config: { ordered: true }, data, view: 'list', widths: [width] })).toBe(
      lines('1.', '2. x', '3.'),
    );
  },
);

test('a default item is escaped while a format item is the author marked text', () => {
  const marker = '["style",[["foreground","red"]]]data';
  expect(render({ data: [marker], view: 'list', widths: [null] })).toBe(lines(`● ${marker}`));
  expect(render({ config: { format: 'raw' }, data: [marker], view: 'list', widths: [null] })).toBe(
    lines('● data'),
  );
});

test('format receives each item index among its siblings', () => {
  const config = { children: true, format: 'index' };
  expect(render({ config, data: services, view: 'list', widths: [40] })).toBe(
    lines('● 0:api-gateway', '● 1:billing', '  ● 0:invoices', '  ● 1:refunds', '● 2:search'),
  );
});

test('a wrapped item hangs under its text at 30 columns', () => {
  const data = ['refunds, whose retry policy lands with this deploy'];
  expect(render({ data, view: 'list', widths: [30] })).toBe(
    lines('● refunds, whose retry policy', '  lands with this deploy'),
  );
});

test('a nested item wraps at the columns left after its own text column', () => {
  const data = [{ name: 'billing', parts: [{ name: 'refunds, whose retry policy lands' }] }];
  const config = { children: true, format: 'name', ordered: true };
  expect(render({ config, data, view: 'list', widths: [24] })).toBe(
    lines('1. billing', '   1. refunds, whose', '      retry policy lands'),
  );
});

test('an authored line break hangs under its text when piped', () => {
  expect(render({ data: ['first line\nsecond line'], view: 'list', widths: [null] })).toBe(
    lines('● first line', '  second line'),
  );
});

test.each([30, null])('a blank line inside an item carries no indent, at %s columns', (width) => {
  expect(render({ data: ['above\n\nbelow'], view: 'list', widths: [width] })).toBe(
    lines('● above', '', '  below'),
  );
});

test('a tab in an item expands on a terminal and is kept when piped', () => {
  expect(render({ data: ['a\tb'], view: 'list', widths: [30, null] })).toBe(
    lines('● a       b', '--', '● a\tb'),
  );
});

test('a list styles its markers dim and a default item primary', () => {
  const rendering = { color: 'always', modifiers: 'always' } as const;
  expect(render({ data: ['a', null], rendering, theme: true, view: 'list', widths: [40] })).toBe(
    '\u001B[90m●\u001B[39m \u001B[36ma\u001B[39m\n\u001B[90m●\u001B[39m\n',
  );
  const config = { ordered: true };
  expect(render({ config, data: ['a'], rendering, theme: true, view: 'list', widths: [40] })).toBe(
    '\u001B[90m1.\u001B[39m \u001B[36ma\u001B[39m\n',
  );
});

test('an empty sequence prints nothing, on a terminal and piped', () => {
  expect(render({ data: [], view: 'list', widths: [30, null] })).toBe(lines('--'));
});
