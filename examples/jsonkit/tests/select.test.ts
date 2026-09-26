import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { document, main, withDocuments } from './documents.js';

test('jsonkit selects the requested fields in supplied order across both spellings', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(
      invoke(
        main,
        ['--file', 'doc.json', 'select', '--field', 'name', '-F', 'tags', '--field=count'],
        {
          cwd,
        },
      ),
    ).toEqual({
      status: 0,
      stderr: '',
      stdout: '{\n  "name": "loom",\n  "tags": [\n    "a",\n    "b"\n  ],\n  "count": 3\n}\n',
    });
  });
});

test('jsonkit warns about a missing field and prints the fields it found', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(
      invoke(main, ['--file', 'doc.json', 'select', '-F', 'name', '-F', 'gone', '-F', 'gone'], {
        cwd,
        env: { TERM: 'xterm-256color' },
      }),
    ).toEqual({
      status: 0,
      stderr: '⚠ Field not found: gone\n',
      stdout: '{\n  "name": "loom"\n}\n',
    });
  });
});

test('jsonkit prints an empty object when every requested field is missing', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(
      invoke(main, ['--file', 'doc.json', 'select', '-F', 'gone', '-F', 'lost'], {
        cwd,
        env: { TERM: 'xterm-256color' },
      }),
    ).toEqual({
      status: 0,
      stderr: '⚠ Field not found: gone\n⚠ Field not found: lost\n',
      stdout: '{}\n',
    });
  });
});

test('jsonkit keeps a repeated field at its first position', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(
      invoke(main, ['--file', 'doc.json', 'select', '-F', 'name', '-F', 'count', '-F', 'name'], {
        cwd,
      }),
    ).toEqual({
      status: 0,
      stderr: '',
      stdout: '{\n  "name": "loom",\n  "count": 3\n}\n',
    });
  });
});

test.each([
  [['--field', ''], 0],
  [['--field='], 0],
  [['--field', 'a', '-F', ''], 1],
])('jsonkit rejects the empty field name in %j at its position', (option, position) => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['select', ...option, '-f', 'doc.json'], { cwd })).toEqual({
      status: 2,
      stderr: `jsonkit: --field at ${position}: Expected a nonempty value.\n`,
      stdout: '',
    });
  });
});

test('jsonkit requires at least one field for select', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['--file', 'doc.json', 'select'], { cwd })).toEqual({
      status: 2,
      stderr: 'jsonkit: --field: required\n',
      stdout: '',
    });
  });
});

test.each([
  ['[1,2,3]', 'array with 3 items'],
  ['"text"', 'string'],
  ['null', 'null'],
])('jsonkit rejects select on the non-object root %s', (contents, kind) => {
  withDocuments({ 'doc.json': contents }, (cwd) => {
    expect(invoke(main, ['--file', 'doc.json', 'select', '-F', 'name'], { cwd })).toEqual({
      status: 1,
      stderr: `Expected an object at the root; found ${kind}\n`,
      stdout: '',
    });
  });
});

test.each([
  [['--file', 'doc.json', 'select', '-F', 'name']],
  [['select', '--file', 'doc.json', '-F', 'name']],
  [['select', '-F', 'name', '--file', 'doc.json']],
  [['select', '-F', 'name', '-f', 'doc.json']],
])('jsonkit selects the same fields for the global placement %j', (args) => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, args, { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: '{\n  "name": "loom"\n}\n',
    });
  });
});

test.each([
  ['nested', 'deep\n'],
  ['nested.deep', 'value\n'],
])('jsonkit lists the keys at the path %s', (path, stdout) => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['--file', 'doc.json', 'keys', path], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout,
    });
  });
});

test('jsonkit lists the root keys when the keys path is omitted', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['--file', 'doc.json', 'keys'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: 'name\ntags\nnested\ncount\nok\nnone\n',
    });
  });
});

test.each(['missing', 'nested.gone', 'tags.2'])(
  'jsonkit reports the unresolved keys path %s',
  (path) => {
    withDocuments({ 'doc.json': document }, (cwd) => {
      expect(invoke(main, ['--file', 'doc.json', 'keys', path], { cwd })).toEqual({
        status: 1,
        stderr: `Path not found: ${path}\n`,
        stdout: '',
      });
    });
  },
);

test.each([
  ['name', 'string'],
  ['tags', 'array with 2 items'],
  ['count', 'number'],
  ['none', 'null'],
])('jsonkit rejects the non-object keys path %s', (path, kind) => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['--file', 'doc.json', 'keys', path], { cwd })).toEqual({
      status: 1,
      stderr: `Expected an object at ${path}; found ${kind}\n`,
      stdout: '',
    });
  });
});

test('the inspected graph publishes the text() input schema for --field', () => {
  const inspected = invoke(new URL('fixtures/inspect.mjs', import.meta.url));
  expect(inspected.status).toBe(0);
  const graph: {
    root: { children: { name: string; options: { name: string; schema: unknown }[] }[] };
  } = JSON.parse(inspected.stdout);
  const found = graph.root.children.find((child) => child.name === 'select');
  expect(found?.options.find((option) => option.name === 'field')?.schema).toEqual({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    minLength: 1,
    type: 'string',
  });
});
