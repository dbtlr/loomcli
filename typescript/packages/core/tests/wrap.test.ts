import { expect, test } from 'vite-plus/test';
// Acceptance plan: see packages/core/tests/style.test.ts.

import { invoke as invokeFixture } from './run-fixture.ts';

type Part =
  | string
  | readonly Part[]
  | { nowrap: Part }
  | { pad: readonly [Part, number, string?] }
  | { style: readonly [readonly string[], Part] }
  | { glyph: string };

/** What `context.wrap(text, columns)` returns once resolved for a stdout pipe. */
async function wrapped(
  text: Part,
  columns: number | string | null,
  options: Record<string, unknown> = {},
) {
  const result = await invokeFixture(new URL('fixtures/wrap.mjs', import.meta.url), [
    JSON.stringify({ columns, text, ...options }),
  ]);
  expect(result.stderr).toBe('');
  return result.stdout;
}

test('greedy fitting takes as many words as fit, and a line exactly columns wide fits', async () => {
  await expect(wrapped('aaa bbb ccc', 7)).resolves.toBe('aaa bbb\nccc');
  await expect(wrapped('aaa bbb ccc', 6)).resolves.toBe('aaa\nbbb\nccc');
  await expect(wrapped('aaa bbbb', 8)).resolves.toBe('aaa bbbb');
  await expect(wrapped('aaa bbbb', 7)).resolves.toBe('aaa\nbbbb');
});

test('a line breaks only at a space, never at a tab, and keeps runs of spaces inside a line', async () => {
  await expect(wrapped('aaaa\tbbbb', 5)).resolves.toBe('aaaa\tbbbb');
  await expect(wrapped('a\tb c', 9)).resolves.toBe('a\tb\nc');
  await expect(wrapped('a  b c', 4)).resolves.toBe('a  b\nc');
  await expect(wrapped('aaa   bbb', 4)).resolves.toBe('aaa\nbbb');
});

test('authored line breaks stay, each line wraps alone, and a break matches its line ending', async () => {
  await expect(wrapped('aaaa\nb c', 3)).resolves.toBe('aaaa\nb c');
  await expect(wrapped('aa bb\ncc dd', 2)).resolves.toBe('aa\nbb\ncc\ndd');
  await expect(wrapped('aa bb\r\ncc dd', 2)).resolves.toBe('aa\r\nbb\r\ncc\ndd');
  await expect(wrapped('aa bb\r\n', 2)).resolves.toBe('aa\r\nbb\r\n');
});

test('leading spaces stay with the first word and are never a break', async () => {
  await expect(wrapped('  /a/very/long/path rest', 10)).resolves.toBe('  /a/very/long/path\nrest');
  await expect(wrapped('    abc', 2)).resolves.toBe('    abc');
});

test('trailing spaces are never a break, stay with the last word, and count toward the fit', async () => {
  await expect(wrapped('abc   ', 3)).resolves.toBe('abc   ');
  await expect(wrapped('ab cd   ', 5)).resolves.toBe('ab\ncd   ');
  await expect(wrapped('ab cd   ', 8)).resolves.toBe('ab cd   ');
  await expect(wrapped('ab cd ef  ', 7)).resolves.toBe('ab cd\nef  ');
});

test('the spaces at a break are dropped and the next line starts at column 0', async () => {
  await expect(wrapped('one two   three', 7)).resolves.toBe('one two\nthree');
});

test('a word wider than columns keeps a line of its own', async () => {
  const url = 'https://example.com/a/very/long/url';
  await expect(wrapped(`see ${url} now`, 10)).resolves.toBe(`see\n${url}\nnow`);
  await expect(wrapped('token 0123456789abcdef0123456789abcdef', 8)).resolves.toBe(
    'token\n0123456789abcdef0123456789abcdef',
  );
});

test('a no-wrap frame is one unit at its body width and never breaks inside', async () => {
  const path = '/Users/a/Library/Application Support/x';
  await expect(wrapped(['Wrote ', { nowrap: path }], 30)).resolves.toBe(`Wrote\n${path}`);
  await expect(wrapped([{ nowrap: 'a b' }, ' c'], 5)).resolves.toBe('a b c');
  await expect(wrapped([{ nowrap: 'a b' }, ' c'], 4)).resolves.toBe('a b\nc');
  await expect(wrapped({ nowrap: 'a b c d' }, 1)).resolves.toBe('a b c d');
  await expect(
    wrapped(['x ', { nowrap: [{ style: [['red'], 'a b'] }, ' ', { glyph: 'tick' }] }], 3, {
      rendering: { color: 'always' },
    }),
  ).resolves.toBe('x\n\u001b[31ma b\u001b[39m ✔');
});

test('a padding frame is one unit at its padded width and never breaks inside', async () => {
  await expect(wrapped([{ pad: ['a b', 6] }, ' c'], 8)).resolves.toBe('a b    c');
  await expect(wrapped([{ pad: ['a b', 6] }, ' c'], 7)).resolves.toBe('a b   \nc');
  await expect(wrapped([{ pad: ['a b', 6] }, ' c'], 6)).resolves.toBe('a b   \nc');
  await expect(wrapped([{ pad: [{ nowrap: 'a b' }, 4] }, ' c'], 1)).resolves.toBe('a b \nc');
  // A line that starts inside a padding frame measures that frame's padding too.
  await expect(wrapped([{ pad: ['x\ny z', 5] }, ' w'], 7)).resolves.toBe('x    \ny z   w');
  await expect(wrapped([{ pad: ['x\ny z', 5] }, ' w'], 6)).resolves.toBe('x    \ny z  \nw');
});

test('a style and a hyperlink that span a break continue across it', async () => {
  await expect(
    wrapped({ style: [['red'], 'aaa bbb'] }, 3, { rendering: { color: 'always' } }),
  ).resolves.toBe('\u001b[31maaa\nbbb\u001b[39m');
  const open = '\u001b]8;;https://example.com\u001b\\';
  const close = '\u001b]8;;\u001b\\';
  await expect(
    wrapped(`${open}aaa bbb${close}`, 3, { rendering: { hyperlinks: 'always' } }),
  ).resolves.toBe(`${open}aaa\nbbb${close}`);
});

test('wrap measures marked glyphs in the destination glyph forms', async () => {
  const text = [{ glyph: 'radioOn' }, ' ab cd'];
  await expect(wrapped(text, 7)).resolves.toBe('◉ ab cd');
  await expect(wrapped(text, 7, { env: { TERM: 'linux' } })).resolves.toBe('(*) ab\ncd');
});

test('wrap measures display width, so wide characters fill two columns each', async () => {
  await expect(wrapped('界界 界界', 8)).resolves.toBe('界界\n界界');
  await expect(wrapped('界界 界界', 9)).resolves.toBe('界界 界界');
});

test.each(['中文文本没有空格可以断开', 'これは日本語の文章です', 'ภาษาไทยไม่มีช่องว่างระหว่างคำ'])(
  'text without spaces comes back unbroken: %s',
  async (text) => {
    await expect(wrapped(text, 2)).resolves.toBe(text);
  },
);

test('an undefined width returns the text unchanged', async () => {
  await expect(wrapped('aaa bbb ccc', null)).resolves.toBe('aaa bbb ccc');
});

test.each([0, -1, 1.5, 'NaN', 'Infinity', 2 ** 53])(
  'wrap rejects the width %j',
  async (columns) => {
    await expect(wrapped('aaa bbb', columns)).resolves.toBe(
      'RangeError: Wrap width must be a positive safe integer.',
    );
  },
);

test('pad centers each line of a wrapped block', async () => {
  await expect(wrapped('aa bbbb', 6, { center: true })).resolves.toBe('  aa  \n bbbb ');
});

/** What `context.expandTabs(text)` returns once resolved for a stdout pipe. */
async function expanded(text: Part, options: Record<string, unknown> = {}) {
  return await wrapped(text, null, { expand: true, ...options });
}

test('expandTabs turns each tab into spaces to the next multiple of eight from its line start', async () => {
  await expect(expanded('a\tb')).resolves.toBe('a       b');
  await expect(expanded('abcdefgh\tb\t')).resolves.toBe(
    `abcdefgh${' '.repeat(8)}b${' '.repeat(7)}`,
  );
  await expect(expanded('ab\tc\r\nabcd\te')).resolves.toBe('ab      c\r\nabcd    e');
  await expect(expanded('no tab')).resolves.toBe('no tab');
});

test('expandTabs measures in the destination glyph forms and keeps every frame working', async () => {
  await expect(expanded([{ glyph: 'radioOn' }, '\tb'])).resolves.toBe('◉       b');
  await expect(expanded([{ glyph: 'radioOn' }, '\tb'], { env: { TERM: 'linux' } })).resolves.toBe(
    '(*)     b',
  );
  const styled: Part = [{ style: [['red'], 'a\tb'] }, { nowrap: 'c\td' }];
  await expect(expanded(styled, { rendering: { color: 'always' } })).resolves.toBe(
    '\u001b[31ma       b\u001b[39mc      d',
  );
});

test('expandTabs leaves a tab inside a pad frame to the frame, and an ANSI payload untouched', async () => {
  await expect(expanded(['x', { pad: ['a\tb', 12] }, '\tc'])).resolves.toBe(
    `xa       b   ${' '.repeat(3)}c`,
  );
  const open = '\u001b]8;;https://example.com/a\tb\u001b\\';
  const close = '\u001b]8;;\u001b\\';
  await expect(
    expanded([open, 'a\tb', close], { rendering: { hyperlinks: 'always' } }),
  ).resolves.toBe(`${open}a       b${close}`);
});
