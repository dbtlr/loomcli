import { expect, test } from 'vite-plus/test';

import { lines } from './fit-render.js';
import { render } from './pack-render.js';

const summary =
  'Three services rolled out to the staging cluster. One health check is still warming up.';

test('prose() wraps at 34 columns and prints as written when piped', () => {
  expect(render({ data: summary, view: 'prose', widths: [34, null] })).toBe(
    lines(
      'Three services rolled out to the',
      'staging cluster. One health check',
      'is still warming up.',
      '--',
      summary,
    ),
  );
});

test('prose() renders as the default view of a declared string result', () => {
  expect(render({ data: summary, declared: true, view: 'prose', widths: [34] })).toBe(
    lines(
      'Three services rolled out to the',
      'staging cluster. One health check',
      'is still warming up.',
    ),
  );
});

test('a blank line separates two paragraphs', () => {
  const data = 'First paragraph here.\n\nSecond paragraph.';
  expect(render({ data, view: 'prose', widths: [12] })).toBe(
    lines('First', 'paragraph', 'here.', '', 'Second', 'paragraph.'),
  );
});

test('a leading indent stays on the first line and continuation lines start at column 0', () => {
  expect(render({ data: '    Indented text wraps here', view: 'prose', widths: [14] })).toBe(
    lines('    Indented', 'text wraps', 'here'),
  );
});

test('a tab expands on a terminal and is kept when piped', () => {
  expect(render({ data: 'a\tb', view: 'prose', widths: [30, null] })).toBe(
    lines('a       b', '--', 'a\tb'),
  );
});

test.each(['Done.', 'Done.\n'])('the text %j ends in exactly one line break', (data) => {
  expect(render({ data, view: 'prose', widths: [30, null] })).toBe(lines('Done.', '--', 'Done.'));
});

test.each(['@@red-empty@@', '@@nowrap-empty@@'])(
  'prose over %s, which resolves to no character, prints nothing',
  (data) => {
    expect(render({ data, view: 'prose', widths: [30, null] })).toBe(lines('--'));
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
  expect(render({ data: '', view: 'prose', widths: [30, null] })).toBe(lines('--'));
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
