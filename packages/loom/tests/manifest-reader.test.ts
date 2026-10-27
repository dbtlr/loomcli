/*
 * Every loom command reads a `package.json` through one reader, so a file it cannot use fails with
 * the same sentence wherever it is read: the file's path, where the JSON breaks, and the fix. The
 * runtime's own parse error is not portable, because Bun's names no position, so the reader finds
 * the line and column itself.
 */
import { expect, test } from 'vite-plus/test';

import { jsonFault } from '../src/helpers/json-fault.js';
import { parseManifest } from '../src/helpers/manifest.js';

const path = '/work/notes/package.json';

test.each([
  [
    'a trailing comma in an object',
    '{\n  "name": "notes",\n}\n',
    3,
    1,
    'a property name in double quotes',
  ],
  [
    'a missing comma between members',
    '{\n  "name": "notes"\n  "version": "1.0.0"\n}\n',
    3,
    3,
    'a comma or }',
  ],
  ['a trailing comma in an array', '{ "files": ["dist",] }', 1, 20, 'a value'],
  ['a missing colon', '{ "name" "notes" }', 1, 10, 'a colon'],
  ['a single-quoted string', "{ 'name': 'notes' }", 1, 3, 'a property name in double quotes'],
  ['an unterminated string', '{ "name": "notes', 1, 17, 'a closing quote'],
  [
    'a line break inside a string',
    '{ "name": "no\ntes" }',
    1,
    14,
    String.raw`a closing quote or an escape such as \n`,
  ],
  [
    'an unknown escape',
    String.raw`{ "name": "no\qtes" }`,
    1,
    14,
    String.raw`an escape such as \n or \t`,
  ],
  ['a misspelled literal', '{ "private": tru }', 1, 14, 'a value'],
  ['a number with a leading zero', '{ "n": 01 }', 1, 9, 'a comma or }'],
  ['a number with no digit after its point', '{ "n": 1. }', 1, 10, 'a digit'],
  ['an empty file', '', 1, 1, 'a value'],
  ['a file of only whitespace', '\n\n', 3, 1, 'a value'],
  ['text after the object', '{ "name": "notes" }\n}', 2, 1, 'the end of the file'],
  ['an object cut short', '{ "name": "notes"', 1, 18, 'a comma or }'],
  ['a comment', '{\n  // the name\n  "name": "notes"\n}', 2, 3, 'a property name in double quotes'],
])(
  '%s is located at its line and column with what the JSON needs there',
  (_case, text, line, column, expected) => {
    expect(jsonFault(text)).toEqual({ column, expected, line });
  },
);

test('a CRLF file counts lines by their line breaks', () => {
  expect(jsonFault('{\r\n  "name": "notes",\r\n}\r\n')).toEqual({
    column: 1,
    expected: 'a property name in double quotes',
    line: 3,
  });
});

test('a column counts characters, so text outside the Basic Multilingual Plane counts once', () => {
  expect(jsonFault('{ "d": "🧵é" "x": 1 }')).toMatchObject({ column: 13, line: 1 });
});

test('valid JSON has no fault, whatever value it holds', () => {
  for (const text of [
    '{}',
    String.raw`[1, -2.5e3, "a\u0041", true, false, null]`,
    '"text"',
    ' 0 ',
  ]) {
    expect(jsonFault(text)).toBeUndefined();
  }
});

test('the reader returns the object with its keys in order and a leading byte order mark ignored', () => {
  const manifest = parseManifest('﻿{ "version": "1.0.0", "name": "notes" }', path);
  expect(Object.keys(manifest)).toEqual(['version', 'name']);
});

test('a manifest that is not valid JSON names its path, its line and column, and the fix', () => {
  expect(() => parseManifest('{\n  "name": "notes",\n}\n', path)).toThrow(
    '/work/notes/package.json is not valid JSON: line 3, column 1 needs a property name in double quotes, so fix it there and run loom again.',
  );
});

test.each([['[]'], ['"notes"'], ['1'], ['null']])(
  'a manifest that holds %s names its path and says to write an object',
  (text) => {
    expect(() => parseManifest(text, path)).toThrow(
      '/work/notes/package.json is not a JSON object, so write its fields between { and } and run loom again.',
    );
  },
);
