// Acceptance plan: see packages/plugins/tests/list.test.ts.
import { nowrap, style } from '@loomcli/core';
import { expect, test, vi } from 'vite-plus/test';

import { prose } from '../src/prose.js';
import { lines } from './fit-render.js';
import { render } from './pack-render.js';
import { TAB, expandTabs, linesOf, measured, width, wordsOf } from './view-measures.js';

const summary =
  'Three services rolled out to the staging cluster. One health check is still warming up.';

test('prose() wraps at the columns on a terminal and prints as written when piped', () => {
  const view = prose();
  const wrapped = linesOf(view.render(summary, measured(view, 34)));
  expect(wrapped.length).toBeGreaterThan(1);
  expect(Math.max(...wrapped.map(width))).toBeLessThanOrEqual(34);
  expect(wrapped.join(' ')).toBe(summary);
  expect(view.render(summary, measured(view, undefined))).toBe(`${summary}\n`);
});

test('prose() renders as the default view of a declared string result', () => {
  const input = { data: summary, view: 'prose', widths: [34] } as const;
  expect(render({ ...input, declared: true })).toBe(render(input));
});

test('a blank line separates two paragraphs', () => {
  const view = prose();
  const output = view.render('First paragraph here.\n\nSecond paragraph.', measured(view, 12));
  const [first = '', second = '', ...rest] = output.split('\n\n');
  expect(rest).toEqual([]);
  expect(wordsOf(first)).toEqual(['First', 'paragraph', 'here.']);
  expect(wordsOf(second)).toEqual(['Second', 'paragraph.']);
});

test('a leading indent stays on the first line, and continuation lines are not indented', () => {
  const view = prose();
  const [first = '', ...rest] = linesOf(
    view.render('    Indented text wraps here', measured(view, 14)),
  );
  expect(first.startsWith('    Indented')).toBe(true);
  expect(rest.length).toBeGreaterThan(0);
  for (const line of rest) {
    expect(line).toBe(line.trimStart());
  }
});

test('a tab expands on a terminal and is kept when piped', () => {
  const view = prose();
  const tabs = vi.fn(expandTabs);
  expect(view.render('a\tb', measured(view, 30, { expandTabs: tabs }))).toBe(`a${TAB}b\n`);
  expect(tabs).toHaveBeenCalledWith('a\tb');
  expect(view.render('a\tb', measured(view, undefined))).toBe('a\tb\n');
});

test.each(['Done.', 'Done.\n'])('the text %j ends in exactly one line break', (data) => {
  const view = prose();
  expect(view.render(data, measured(view, 30))).toBe('Done.\n');
  expect(view.render(data, measured(view, undefined))).toBe('Done.\n');
});

test.each([
  ['a style frame', style.red('')],
  ['a nowrap frame', nowrap('')],
])(
  'prose over %s around nothing, which resolves to no character, prints nothing',
  (_name, data) => {
    const view = prose();
    expect(view.render(data, measured(view, 30))).toBe('');
    expect(view.render(data, measured(view, undefined))).toBe('');
  },
);

test('prose adds no styling and keeps its author styling', () => {
  const data = '["style",[["foreground","red"]]]Hi there';
  const rendering = { color: 'always', modifiers: 'always' } as const;
  expect(render({ data, rendering, theme: true, view: 'prose', widths: [40] })).toBe(
    '\u001B[31mHi\u001B[39m there\n',
  );
});

test('the empty string prints nothing', () => {
  const view = prose();
  expect(view.render('', measured(view, 30))).toBe('');
  expect(view.render('', measured(view, undefined))).toBe('');
});

test('an OSC 8 hyperlink closes at the end of each wrapped line', () => {
  const open = '\u001B]8;;https://example.com\u001B\\';
  const close = '\u001B]8;;\u001B\\';
  const rendering = { color: 'never', hyperlinks: 'always', modifiers: 'never' } as const;
  const data = `${open}see the release notes${close}`;
  expect(render({ data, rendering, view: 'prose', widths: [14] })).toBe(
    lines(`${open}see the${close}`, `${open}release notes${close}`),
  );
});
