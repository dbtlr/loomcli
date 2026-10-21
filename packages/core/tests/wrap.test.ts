// Acceptance plan: see packages/core/tests/style.test.ts.

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

type Part =
  | string
  | readonly Part[]
  | { nowrap: Part }
  | { pad: readonly [Part, number, string?] }
  | { style: readonly [readonly string[], Part] }
  | { glyph: string };

/** What `context.wrap(text, columns)` returns once resolved for a stdout pipe. */
function wrapped(
  text: Part,
  columns: number | string | null,
  options: Record<string, unknown> = {},
) {
  const result = invoke(new URL('fixtures/wrap.mjs', import.meta.url), [
    JSON.stringify({ columns, text, ...options }),
  ]);
  expect(result.stderr).toBe('');
  return result.stdout;
}

test('greedy fitting takes as many words as fit, and a line exactly columns wide fits', () => {
  expect(wrapped('aaa bbb ccc', 7)).toBe('aaa bbb\nccc');
  expect(wrapped('aaa bbb ccc', 6)).toBe('aaa\nbbb\nccc');
  expect(wrapped('aaa bbbb', 8)).toBe('aaa bbbb');
  expect(wrapped('aaa bbbb', 7)).toBe('aaa\nbbbb');
});

test('a line breaks only at a space, never at a tab, and keeps runs of spaces inside a line', () => {
  expect(wrapped('aaaa\tbbbb', 5)).toBe('aaaa\tbbbb');
  expect(wrapped('a\tb c', 9)).toBe('a\tb\nc');
  expect(wrapped('a  b c', 4)).toBe('a  b\nc');
  expect(wrapped('aaa   bbb', 4)).toBe('aaa\nbbb');
});

test('authored line breaks stay, each line wraps alone, and a break matches its line ending', () => {
  expect(wrapped('aaaa\nb c', 3)).toBe('aaaa\nb c');
  expect(wrapped('aa bb\ncc dd', 2)).toBe('aa\nbb\ncc\ndd');
  expect(wrapped('aa bb\r\ncc dd', 2)).toBe('aa\r\nbb\r\ncc\ndd');
  expect(wrapped('aa bb\r\n', 2)).toBe('aa\r\nbb\r\n');
});

test('leading spaces stay with the first word and are never a break', () => {
  expect(wrapped('  /a/very/long/path rest', 10)).toBe('  /a/very/long/path\nrest');
  expect(wrapped('    abc', 2)).toBe('    abc');
});

test('trailing spaces are never a break, stay with the last word, and count toward the fit', () => {
  expect(wrapped('abc   ', 3)).toBe('abc   ');
  expect(wrapped('ab cd   ', 5)).toBe('ab\ncd   ');
  expect(wrapped('ab cd   ', 8)).toBe('ab cd   ');
  expect(wrapped('ab cd ef  ', 7)).toBe('ab cd\nef  ');
});

test('the spaces at a break are dropped and the next line starts at column 0', () => {
  expect(wrapped('one two   three', 7)).toBe('one two\nthree');
});

test('a word wider than columns keeps a line of its own', () => {
  const url = 'https://example.com/a/very/long/url';
  expect(wrapped(`see ${url} now`, 10)).toBe(`see\n${url}\nnow`);
  expect(wrapped('token 0123456789abcdef0123456789abcdef', 8)).toBe(
    'token\n0123456789abcdef0123456789abcdef',
  );
});

test('a no-wrap frame is one unit at its body width and never breaks inside', () => {
  const path = '/Users/a/Library/Application Support/x';
  expect(wrapped(['Wrote ', { nowrap: path }], 30)).toBe(`Wrote\n${path}`);
  expect(wrapped([{ nowrap: 'a b' }, ' c'], 5)).toBe('a b c');
  expect(wrapped([{ nowrap: 'a b' }, ' c'], 4)).toBe('a b\nc');
  expect(wrapped({ nowrap: 'a b c d' }, 1)).toBe('a b c d');
  expect(
    wrapped(['x ', { nowrap: [{ style: [['red'], 'a b'] }, ' ', { glyph: 'tick' }] }], 3, {
      rendering: { color: 'always' },
    }),
  ).toBe('x\n\u001b[31ma b\u001b[39m ✔');
});

test('a padding frame is one unit at its padded width and never breaks inside', () => {
  expect(wrapped([{ pad: ['a b', 6] }, ' c'], 8)).toBe('a b    c');
  expect(wrapped([{ pad: ['a b', 6] }, ' c'], 7)).toBe('a b   \nc');
  expect(wrapped([{ pad: ['a b', 6] }, ' c'], 6)).toBe('a b   \nc');
  expect(wrapped([{ pad: [{ nowrap: 'a b' }, 4] }, ' c'], 1)).toBe('a b \nc');
  // A line that starts inside a padding frame measures that frame's padding too.
  expect(wrapped([{ pad: ['x\ny z', 5] }, ' w'], 7)).toBe('x    \ny z   w');
  expect(wrapped([{ pad: ['x\ny z', 5] }, ' w'], 6)).toBe('x    \ny z  \nw');
});

test('a style and a hyperlink that span a break continue across it', () => {
  expect(wrapped({ style: [['red'], 'aaa bbb'] }, 3, { rendering: { color: 'always' } })).toBe(
    '\u001b[31maaa\nbbb\u001b[39m',
  );
  const open = '\u001b]8;;https://example.com\u001b\\';
  const close = '\u001b]8;;\u001b\\';
  expect(wrapped(`${open}aaa bbb${close}`, 3, { rendering: { hyperlinks: 'always' } })).toBe(
    `${open}aaa\nbbb${close}`,
  );
});

test('wrap measures marked glyphs in the destination glyph forms', () => {
  const text = [{ glyph: 'radioOn' }, ' ab cd'];
  expect(wrapped(text, 7)).toBe('◉ ab cd');
  expect(wrapped(text, 7, { env: { TERM: 'linux' } })).toBe('(*) ab\ncd');
});

test('wrap measures display width, so wide characters fill two columns each', () => {
  expect(wrapped('界界 界界', 8)).toBe('界界\n界界');
  expect(wrapped('界界 界界', 9)).toBe('界界 界界');
});

test.each(['中文文本没有空格可以断开', 'これは日本語の文章です', 'ภาษาไทยไม่มีช่องว่างระหว่างคำ'])(
  'text without spaces comes back unbroken: %s',
  (text) => {
    expect(wrapped(text, 2)).toBe(text);
  },
);

test('an undefined width returns the text unchanged', () => {
  expect(wrapped('aaa bbb ccc', null)).toBe('aaa bbb ccc');
});

test.each([0, -1, 1.5, 'NaN', 'Infinity', 2 ** 53])('wrap rejects the width %j', (columns) => {
  expect(wrapped('aaa bbb', columns)).toBe(
    'RangeError: Wrap width must be a positive safe integer.',
  );
});

test('pad centers each line of a wrapped block', () => {
  expect(wrapped('aa bbbb', 6, { center: true })).toBe('  aa  \n bbbb ');
});

/** What `context.expandTabs(text)` returns once resolved for a stdout pipe. */
function expanded(text: Part, options: Record<string, unknown> = {}) {
  return wrapped(text, null, { expand: true, ...options });
}

test('expandTabs turns each tab into spaces to the next multiple of eight from its line start', () => {
  expect(expanded('a\tb')).toBe('a       b');
  expect(expanded('abcdefgh\tb\t')).toBe(`abcdefgh${' '.repeat(8)}b${' '.repeat(7)}`);
  expect(expanded('ab\tc\r\nabcd\te')).toBe('ab      c\r\nabcd    e');
  expect(expanded('no tab')).toBe('no tab');
});

test('expandTabs measures in the destination glyph forms and keeps every frame working', () => {
  expect(expanded([{ glyph: 'radioOn' }, '\tb'])).toBe('◉       b');
  expect(expanded([{ glyph: 'radioOn' }, '\tb'], { env: { TERM: 'linux' } })).toBe('(*)     b');
  const styled: Part = [{ style: [['red'], 'a\tb'] }, { nowrap: 'c\td' }];
  expect(expanded(styled, { rendering: { color: 'always' } })).toBe(
    '\u001b[31ma       b\u001b[39mc      d',
  );
});

test('expandTabs leaves a tab inside a pad frame to the frame, and an ANSI payload untouched', () => {
  expect(expanded(['x', { pad: ['a\tb', 12] }, '\tc'])).toBe(`xa       b   ${' '.repeat(3)}c`);
  const open = '\u001b]8;;https://example.com/a\tb\u001b\\';
  const close = '\u001b]8;;\u001b\\';
  expect(expanded([open, 'a\tb', close], { rendering: { hyperlinks: 'always' } })).toBe(
    `${open}a       b${close}`,
  );
});
