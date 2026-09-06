import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const main = new URL('../dist/main.js', import.meta.url);
const document =
  '{"name":"loom","tags":["a","b"],"nested":{"deep":{"value":"found"}},"count":3,"ok":true,"none":null}';
const summary = [
  'object with 6 keys',
  'name\tstring',
  'tags\tarray with 2 items',
  'nested\tobject with 1 key',
  'count\tnumber',
  'ok\tboolean',
  'none\tnull',
  '',
].join('\n');

/** Every case runs the built application in a throwaway directory of JSON documents. */
function withDocuments(files: Record<string, string>, run: (cwd: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-jsonkit-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(directory, name), contents);
    }
    run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test('jsonkit summarizes an object with one kind line per key', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['--file', 'doc.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: summary,
    });
  });
});

test.each([
  ['[1,2,3]', 'array with 3 items\n'],
  ['[1]', 'array with 1 item\n'],
  ['{}', 'object with 0 keys\n'],
  ['"text"', 'string\n'],
  ['42', 'number\n'],
  ['true', 'boolean\n'],
  ['null', 'null\n'],
])('jsonkit summarizes %s with only its kind line', (contents, stdout) => {
  withDocuments({ 'doc.json': contents }, (cwd) => {
    expect(invoke(main, ['--file', 'doc.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout,
    });
  });
});

test.each([
  ['nested.deep.value', '"found"\n'],
  ['tags.1', '"b"\n'],
  ['count', '3\n'],
  ['none', 'null\n'],
  ['nested.deep', '{\n  "value": "found"\n}\n'],
  ['tags', '[\n  "a",\n  "b"\n]\n'],
])('jsonkit prints the JSON text at %s', (path, stdout) => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['--file', 'doc.json', 'get', path], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout,
    });
  });
});

test.each(['missing', 'nested.missing', 'tags.2', 'name.length', 'tags.first'])(
  'jsonkit reports the unresolved path %s',
  (path) => {
    withDocuments({ 'doc.json': document }, (cwd) => {
      expect(invoke(main, ['get', path, '--file', 'doc.json'], { cwd })).toEqual({
        status: 1,
        stderr: `Path not found: ${path}\n`,
        stdout: '',
      });
    });
  },
);

test('jsonkit lists the keys of an object in JavaScript property order', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['keys', '--file', 'doc.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: 'name\ntags\nnested\ncount\nok\nnone\n',
    });
  });
});

test('jsonkit lists integer-like keys first, as JavaScript orders them', () => {
  withDocuments({ 'doc.json': '{"b": 1, "2": 2, "a": 3}' }, (cwd) => {
    expect(invoke(main, ['keys', '--file', 'doc.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: '2\nb\na\n',
    });
  });
});

test('jsonkit prints nothing for the keys of an empty object', () => {
  withDocuments({ 'doc.json': '{}' }, (cwd) => {
    expect(invoke(main, ['keys', '--file', 'doc.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: '',
    });
  });
});

test.each([
  ['[1,2,3]', 'array with 3 items'],
  ['"text"', 'string'],
  ['42', 'number'],
  ['true', 'boolean'],
  ['null', 'null'],
])('jsonkit rejects keys on the non-object root %s', (contents, kind) => {
  withDocuments({ 'doc.json': contents }, (cwd) => {
    expect(invoke(main, ['keys', '-f', 'doc.json'], { cwd })).toEqual({
      status: 1,
      stderr: `Expected an object at the root; found ${kind}\n`,
      stdout: '',
    });
  });
});

test.each([[[]], [['get', 'name']], [['keys']]])(
  'jsonkit reports a read failure for %j',
  (args) => {
    const result = invoke(main, ['--file', 'missing.json', ...args]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Cannot read file: missing.json: ');
    expect(result.stderr).toContain('ENOENT');
  },
);

test.each([
  ['malformed.json', '{"name":'],
  ['empty.json', ''],
  ['text.json', 'not json at all'],
])('jsonkit reports a parse failure for %s', (file, contents) => {
  withDocuments({ [file]: contents }, (cwd) => {
    const result = invoke(main, ['--file', file], { cwd });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Cannot parse JSON in ${file}: `);
    expect(result.stderr.trimEnd().length).toBeGreaterThan(`Cannot parse JSON in ${file}: `.length);
  });
});

test.each([[[]], [['get', 'name']], [['keys']]])(
  'jsonkit requires the file global for %j before any file access',
  (args) => {
    expect(invoke(main, args)).toEqual({
      status: 2,
      stderr: 'Invalid input: Option "--file" is required. Supply a value.\n',
      stdout: '',
    });
  },
);

test.each([
  [['--file', 'doc.json', 'get', 'name']],
  [['get', '--file', 'doc.json', 'name']],
  [['get', 'name', '--file', 'doc.json']],
  [['get', 'name', '--file=doc.json']],
  [['-f', 'doc.json', 'get', 'name']],
])('jsonkit reads the same value for the global placement %j', (args) => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, args, { cwd })).toEqual({ status: 0, stderr: '', stdout: '"loom"\n' });
  });
});

test('jsonkit treats a route name after --file as the option value', () => {
  withDocuments({ keys: document }, (cwd) => {
    expect(invoke(main, ['--file', 'keys', 'get', 'name'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: '"loom"\n',
    });
  });
});

test('jsonkit ignores a passthrough tail that repeats the file global', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(
      invoke(main, ['keys', '--file', 'doc.json', '--', '--file', 'other.json'], { cwd }),
    ).toEqual({ status: 0, stderr: '', stdout: 'name\ntags\nnested\ncount\nok\nnone\n' });
  });
});

test.each(['summary', 'gets', 'Get'])(
  'jsonkit rejects the unknown command %s and lists the choices',
  (name) => {
    withDocuments({ 'doc.json': document }, (cwd) => {
      expect(invoke(main, ['--file', 'doc.json', name], { cwd })).toEqual({
        status: 2,
        stderr: `Invalid input: Unknown command "${name}". Use one of: get, keys.\n`,
        stdout: '',
      });
    });
  },
);

test('jsonkit runs through a supplied host with its own argv and cwd', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url))).toEqual({
    status: 0,
    stderr: '',
    stdout: '"loom"\n',
  });
});
