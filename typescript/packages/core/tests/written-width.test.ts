// Acceptance plan: see packages/core/tests/style.test.ts.

import { width } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

test.each([
  [
    'an SGR style and an OSC 8 link ended by ST',
    '\u001b[1mName\u001b[22m  \u001b]8;;https://example.com\u001b\\docs\u001b]8;;\u001b\\',
    10,
  ],
  ['an OSC 8 link ended by BEL', '\u001b]8;;https://example.com\u0007docs\u001b]8;;\u0007', 4],
  ['wide characters and a tab to the next stop', '名前\tok', 10],
])('width skips every control sequence: %s', (_name, written, columns) => {
  expect(width(written)).toBe(columns);
});

test('width emulates no cursor movement, so overwritten text still counts', () => {
  expect(width('abc\u001b[2Dxy')).toBe(5);
  expect(width('abcd\rxy')).toBe(6);
});

test.each([
  ['CJK', '日本語', 6],
  ['an emoji ZWJ sequence', '👩‍💻', 2],
  ['a flag', '🇯🇵', 2],
  ['a combining mark', 'é', 1],
])('width counts grapheme clusters as the view context does: %s', (_name, written, columns) => {
  expect(width(written)).toBe(columns);
});

test('width is the widest line, with LF and CRLF as line breaks', () => {
  expect(width('abc\r\nabcdef\nab')).toBe(6);
  expect(width('\u001b[31mabcdefghij\u001b[39m\n\tx')).toBe(10);
});
