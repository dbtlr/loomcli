import { expect, test } from 'vite-plus/test';

import { parseFile } from '../src/config/formats.js';

/** The reading of a file that does not parse, with its position. */
function broken(clause: string, line: number, column: number) {
  return { at: { column, line }, clause, kind: 'unusable' };
}

test.each([
  ['a line comment', '{\n  // the threshold\n  "minBytes": 5\n}', { minBytes: 5 }],
  ['a block comment', '{ /* why */ "minBytes": /* bytes */ 5 }', { minBytes: 5 }],
  ['a comment last', '{ "minBytes": 5 } // done', { minBytes: 5 }],
  ['a trailing comma in an object', '{ "minBytes": 5, }', { minBytes: 5 }],
  ['a trailing comma in an array', '{ "fields": ["a", "b",] }', { fields: ['a', 'b'] }],
  ['a trailing comma before a comment', '{ "fields": ["a", // last\n] }', { fields: ['a'] }],
  ['comment text inside a string', '{ "url": "https://x/*y*/" }', { url: 'https://x/*y*/' }],
])('a JSON file reads %s', async (_case, text, object) => {
  await expect(parseFile('.app.json', text)).resolves.toEqual({ kind: 'usable', object });
});

test('a .jsonc file and a file of any other name read comments the same way', async () => {
  for (const path of ['.app.jsonc', '.apprc', 'config.cfg']) {
    await expect(parseFile(path, '{ "minBytes": 1, // note\n }')).resolves.toEqual({
      kind: 'usable',
      object: { minBytes: 1 },
    });
  }
});

test('a JSON file with comments reads the values JSON.parse reads, a __proto__ key as an own key', async () => {
  const text = String.raw`{ "__proto__": { "polluted": true }, "n": 1e2, "s": "\u00e9\n", /* c */ "x": null }`;
  const reading = await parseFile('.app.json', text);
  expect(reading).toEqual({ kind: 'usable', object: JSON.parse(text.replace('/* c */', '')) });
  expect(reading.kind === 'usable' && Object.getPrototypeOf(reading.object)).toBe(Object.prototype);
  expect(reading.kind === 'usable' && Object.hasOwn(reading.object, '__proto__')).toBe(true);
});

test.each([
  ['an empty file', '', 1, 1],
  ['a missing value', '{"limits": ', 1, 12],
  ['a value on a later line', '{\n  "a": 1,\n  "b": tru\n}', 3, 8],
  ['a lone comma', '[,]', 1, 2],
  ['two commas', '[1,,]', 1, 4],
  ['a comma with nothing before it', '{,}', 1, 2],
  ['a key without quotes', '{ a: 1 }', 1, 3],
  ['a missing colon', '{ "a" 1 }', 1, 7],
  ['a leading zero', '[01]', 1, 3],
  ['a bare point', '[1.]', 1, 3],
  ['a raw line break in a string', '{ "a": "x\ny" }', 1, 10],
  ['an unknown escape', String.raw`{ "a": "\x" }`, 1, 9],
  ['a short unicode escape', String.raw`{ "a": "\u12" }`, 1, 9],
  ['an unterminated string', '{ "a": "x', 1, 10],
  ['an unterminated block comment', '{ "a": 1 /* never closed', 1, 10],
  ['a single slash', '{ "a": 1 / }', 1, 10],
  ['a second value', '{} {}', 1, 4],
  ['a non-breaking space', '{ }', 1, 2],
  ['a mismatched bracket', '{ "a": [1} }', 1, 10],
  ['an unclosed object', '{ "a": 1', 1, 9],
])('a JSON file with %s names its line and column', async (_case, text, line, column) => {
  await expect(parseFile('.app.json', text)).resolves.toEqual(
    broken('is not valid JSON.', line, column),
  );
});

test('a column counts characters, so an emoji or an accent before the fault counts once', async () => {
  await expect(parseFile('.app.json', '{ "é😀": x }')).resolves.toEqual(
    broken('is not valid JSON.', 1, 9),
  );
});

test('a line ends at LF, at CRLF, or at a lone CR', async () => {
  await expect(parseFile('.app.json', '{\r\n"a": 1,\r\n"b": x}')).resolves.toEqual(
    broken('is not valid JSON.', 3, 6),
  );
  await expect(parseFile('.app.json', '{\r"a": x}')).resolves.toEqual(
    broken('is not valid JSON.', 2, 6),
  );
});

test('a leading byte order mark is not a column', async () => {
  await expect(parseFile('.app.json', '﻿{ x }')).resolves.toEqual(
    broken('is not valid JSON.', 1, 3),
  );
});

test('a JSON file whose top level is not an object has no position', async () => {
  await expect(parseFile('.app.json', '[1] // a list')).resolves.toEqual({
    clause: 'does not hold a JSON object.',
    kind: 'unusable',
  });
});

test('a TOML file that does not parse names its line and column', async () => {
  await expect(parseFile('.app.toml', 'a = 1\nb = \nc = 3\n')).resolves.toEqual(
    broken('is not valid TOML.', 2, 5),
  );
  await expect(parseFile('.app.toml', 'a = 1\r\nb = "é😀" x\r\n')).resolves.toEqual(
    broken('is not valid TOML.', 2, 10),
  );
});

test('a YAML file that does not parse names its line and column', async () => {
  await expect(parseFile('.app.yaml', 'a: 1\nb: [1, 2\n')).resolves.toEqual(
    broken('is not valid YAML.', 3, 1),
  );
  await expect(parseFile('.app.yaml', 'a: 1\na: 2\n')).resolves.toEqual(
    broken('is not valid YAML.', 2, 1),
  );
});

test('a YAML tag outside the core schema names its line and column', async () => {
  await expect(parseFile('.app.yaml', 'a: 1\nb: !!binary aGk=\n')).resolves.toEqual(
    broken('is not valid YAML.', 2, 4),
  );
});

test('a YAML alias that names no preceding anchor names the alias', async () => {
  await expect(parseFile('.app.yaml', 'a: 1\nb: *missing\n')).resolves.toEqual(
    broken('is not valid YAML.', 2, 4),
  );
});
