import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { document, main, withDocuments } from './documents.js';

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

test.each([
  [[], summary],
  [['get', 'name'], '"loom"\n'],
  [['keys'], 'name\ntags\nnested\ncount\nok\nnone\n'],
  [['select', '--field', 'name'], '{\n  "name": "loom"\n}\n'],
] satisfies [string[], string][])('jsonkit reads the piped document for %j', (args, stdout) => {
  expect(invoke(main, args, { input: document })).toEqual({ status: 0, stderr: '', stdout });
});

test.each(['', '{"name":', 'not json at all'])(
  'jsonkit reports a parse failure for the piped text %j',
  (input) => {
    const result = invoke(main, [], { input });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Cannot parse JSON in stdin: ');
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
        stderr: `Invalid input: Unknown command "${name}". Use one of: get, keys, select.\n`,
        stdout: '',
      });
    });
  },
);

test.each(['cwd', 'stdin'])(
  'jsonkit runs through a supplied host for the %s scenario',
  (scenario) => {
    expect(invoke(new URL('fixtures/host.mjs', import.meta.url), [scenario])).toEqual({
      status: 0,
      stderr: '',
      stdout: '"loom"\n',
    });
  },
);

test('jsonkit asks for a file or piped JSON when stdin is a terminal', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['terminal'])).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--file": Supply a file or pipe JSON to stdin.\n',
    stdout: '',
  });
});

test('jsonkit reads a supplied file at a terminal, because the file answers the rule', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['terminal-file'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '"loom"\n',
  });
});

test('jsonkit reports the reason a stdin read failed', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['unreadable']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('Cannot read stdin: The connection failed.\n');
});

test('jsonkit reports a stdin connection that closed before it ended', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['closed-early']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/^Cannot read stdin: .+\n$/u);
});

test('jsonkit never reads stdin when the file global is supplied', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['file-only'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '"loom"\n0\treads\n',
  });
});
