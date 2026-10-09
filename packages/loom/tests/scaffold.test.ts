import { expect, test } from 'vite-plus/test';

import { applicationName, scaffoldName } from '../src/helpers/build-facts.js';
import {
  addMissingKeys,
  applicationIdentifier,
  isNewPackageName,
  scaffoldKeys,
} from '../src/helpers/scaffold.js';

test.each([
  ['notes', 'notes'],
  ['my-notes', 'myNotes'],
  ['notes.cli', 'notesCli'],
  ['my notes!', 'myNotes'],
  ['123abc', 'app123abc'],
  ['---', 'app'],
  ['delete', 'appDelete'],
])('the application %j exports its Application as %s', (name, identifier) => {
  expect(applicationIdentifier(name)).toBe(identifier);
});

/** A manifest with the supplied fields and nothing else. */
function manifest(fields: { bin?: unknown; name?: unknown }) {
  return { bin: fields.bin, name: fields.name, repository: undefined, version: undefined };
}

test.each([
  ['an object bin with one key names the application', { bin: { nb: 'x' }, name: 'notes' }, 'nb'],
  ['a string bin leaves the name without its scope', { bin: 'x', name: '@acme/notes' }, 'notes'],
  ['no bin leaves the name without its scope', { name: '@acme/notes' }, 'notes'],
  [
    'a bin with several keys leaves the package name',
    { bin: { nb: 'x', notes: 'y' }, name: 'notes' },
    'notes',
  ],
])('the scaffold name: %s', (_case, fields, name) => {
  expect(scaffoldName(manifest(fields))).toBe(name);
});

test('a package with no bin and no name has no scaffold name', () => {
  expect(() => scaffoldName(manifest({}))).toThrow('set its name field');
});

test('a build still needs a bin to name its application', () => {
  expect(() => applicationName(manifest({ name: 'notes' }), undefined)).toThrow('--name');
});

const keys = scaffoldKeys('notes', '1.2.3');

test('every missing key is added at the end of its object, in the scaffold order', () => {
  const { added, text } = addMissingKeys('{\n  "name": "notes",\n  "type": "module"\n}\n', keys);
  expect(added).toEqual([
    'bin',
    'scripts.build',
    'scripts.check',
    'dependencies.@loomcli/core',
    'devDependencies.@loomcli/loom',
  ]);
  expect(Object.keys(JSON.parse(text))).toEqual([
    'name',
    'type',
    'bin',
    'scripts',
    'dependencies',
    'devDependencies',
  ]);
  expect(JSON.parse(text)).toMatchObject({
    bin: { notes: 'dist/main.js' },
    dependencies: { '@loomcli/core': '1.2.3' },
    devDependencies: { '@loomcli/loom': '1.2.3' },
    scripts: { build: 'loom build --target node', check: 'loom check' },
  });
});

test('an existing key keeps its value and its place, and new keys follow the existing ones', () => {
  const source = `${JSON.stringify(
    {
      bin: 'dist/cli.js',
      dependencies: { zod: '^4.0.0' },
      name: 'notes',
      scripts: { build: 'tsc', test: 'vitest' },
    },
    undefined,
    2,
  )}\n`;
  const { added, text } = addMissingKeys(source, keys);
  expect(added).toEqual([
    'scripts.check',
    'dependencies.@loomcli/core',
    'devDependencies.@loomcli/loom',
  ]);
  const result = JSON.parse(text);
  expect(result.bin).toBe('dist/cli.js');
  expect(result.scripts).toEqual({ build: 'tsc', check: 'loom check', test: 'vitest' });
  expect(Object.keys(result.scripts)).toEqual(['build', 'test', 'check']);
  expect(Object.keys(result.dependencies)).toEqual(['zod', '@loomcli/core']);
});

test.each([
  ['four spaces', '    '],
  ['a tab', '\t'],
])('a file indented with %s keeps its indentation', (_case, indent) => {
  const { text } = addMissingKeys(`{\n${indent}"name": "notes"\n}\n`, keys);
  expect(text).toBe(`${JSON.stringify(JSON.parse(text), undefined, indent)}\n`);
});

test('a file without a trailing newline gains none', () => {
  const { text } = addMissingKeys('{"name":"notes"}', keys);
  expect(text.endsWith('}')).toBe(true);
  expect(text).toContain('\n  "bin": {');
});

test('a file with every key comes back byte-identical', () => {
  const { text: complete } = addMissingKeys('{\n    "name": "notes"\n}', keys);
  expect(addMissingKeys(complete, keys)).toEqual({ added: [], text: complete });
});

test('a key whose parent is not an object is left out', () => {
  const { added } = addMissingKeys('{"name":"notes","scripts":"none"}', keys);
  expect(added).not.toContain('scripts.build');
});

/** U+FEFF, the byte-order mark, written by its decimal code point. */
const byteOrderMark = String.fromCodePoint(65_279);

test('a file that opens with a byte-order mark keeps it', () => {
  const { text } = addMissingKeys(`${byteOrderMark}{\n  "name": "notes"\n}\n`, keys);
  expect(text.startsWith(`${byteOrderMark}{\n  "name": "notes",\n`)).toBe(true);
});

test('a file with CRLF line endings keeps them on every line', () => {
  const { text } = addMissingKeys('{\r\n  "name": "notes"\r\n}\r\n', keys);
  expect(text.endsWith('}\r\n')).toBe(true);
  expect(text.replaceAll('\r\n', '')).not.toContain('\n');
});

test.each([
  ['notes', true],
  ['notes.cli', true],
  ['notes2', true],
  ['my-notes_1', true],
  ['My Notes', false],
  ['notes cli', false],
  ['@notes', false],
  ['.notes', false],
  ['_notes', false],
  ['-notes', false],
  ['n'.repeat(215), false],
])('the directory name %j can name a new package: %s', (name, valid) => {
  expect(isNewPackageName(name)).toBe(valid);
});
