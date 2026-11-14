import { expect, test } from 'vite-plus/test';

import { positionAt, scanJson } from '../src/index.js';

test('both modes accept strict JSON and hand back the text unchanged', () => {
  const text = String.raw`{ "a": [1, -2.5e3, "xA", true, null], "b": {} }`;
  for (const mode of ['strict', 'comments'] as const) {
    expect(scanJson(text, mode)).toEqual({ json: text });
  }
});

test('the comments mode blanks comments and trailing commas, and the strict mode refuses them', () => {
  const text = '{ "a": [1, /* c */ 2,], // end\n}';
  expect(scanJson(text, 'comments')).toEqual({
    json: `{ "a": [1,${' '.repeat(9)}2 ]${' '.repeat(8)}\n}`,
  });
  expect(scanJson('{ "a": 1 // c\n}', 'strict')).toEqual({
    expected: 'a comma or }',
    offset: 9,
  });
  expect(scanJson('[1,]', 'strict')).toEqual({ expected: 'a value', offset: 3 });
  expect(scanJson('{"a":1,}', 'strict')).toEqual({
    expected: 'a property name in double quotes',
    offset: 7,
  });
});

test('a strict scan names a cut-short number where its digit is missing', () => {
  expect(scanJson('[1.]', 'strict')).toEqual({ expected: 'a digit', offset: 3 });
  expect(scanJson('[1e+]', 'strict')).toEqual({ expected: 'a digit', offset: 4 });
  expect(scanJson('[-]', 'strict')).toEqual({ expected: 'a digit', offset: 2 });
  expect(scanJson('[1.5.2]', 'strict')).toEqual({ expected: 'a comma or ]', offset: 4 });
  expect(scanJson('[1e5.]', 'strict')).toEqual({ expected: 'a comma or ]', offset: 4 });
});

test('a comments scan stops a cut-short number at the character that cannot continue it', () => {
  expect(scanJson('[1.]', 'comments')).toMatchObject({ offset: 2 });
});

test('a strict scan says what a broken string needs', () => {
  expect(scanJson('"ab', 'strict')).toEqual({ expected: 'a closing quote', offset: 3 });
  expect(scanJson('"a\nb"', 'strict')).toMatchObject({ offset: 2 });
  expect(scanJson(String.raw`"a\q"`, 'strict')).toEqual({
    expected: String.raw`an escape such as \n or \t`,
    offset: 2,
  });
});

test.each([
  ['LF', '\n', 3, 6],
  ['CRLF', '\r\n', 3, 6],
  ['a lone CR', '\r', 3, 6],
])(
  'both modes break at one offset and %s ends a line for one position rule',
  (_name, ending, line, column) => {
    const text = `{${ending}"é😀": 1,${ending}"b": x}`;
    for (const mode of ['strict', 'comments'] as const) {
      const scan = scanJson(text, mode);
      expect('offset' in scan && positionAt(text, scan.offset)).toEqual({ column, line });
    }
  },
);

test('a column counts code points, so an astral character counts once', () => {
  expect(positionAt('"🧵é" x', 5)).toEqual({ column: 5, line: 1 });
});

test('a line break that is not LF, CRLF, or CR does not end a line', () => {
  expect(positionAt(`a${String.fromCodePoint(0x20_28)}b${String.fromCodePoint(0x85)}c`, 5)).toEqual(
    {
      column: 6,
      line: 1,
    },
  );
});
