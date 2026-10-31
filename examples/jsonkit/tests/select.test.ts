import { expect, test } from 'vite-plus/test';

import { document, withDocuments } from './documents.js';
import { inspection, run } from './run.js';

test('jsonkit selects the requested fields in supplied order across both spellings', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(
      run(['--file', 'doc.json', 'select', '--field', 'name', '-F', 'tags', '--field=count'], {
        cwd,
      }),
    ).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: '{\n  "name": "loom",\n  "tags": [\n    "a",\n    "b"\n  ],\n  "count": 3\n}\n',
    });
  });
});

test('jsonkit warns about a missing field and prints the fields it found', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(
      run(['--file', 'doc.json', 'select', '-F', 'name', '-F', 'gone', '-F', 'gone'], {
        cwd,
        env: { TERM: 'xterm-256color' },
      }),
    ).resolves.toEqual({
      status: 0,
      stderr: '⚠ Field not found: "gone". Run jsonkit keys to list the fields.\n',
      stdout: '{\n  "name": "loom"\n}\n',
    });
  });
});

test('jsonkit quotes a missing field and escapes its markup and bidirectional controls', async () => {
  const field = `\uE000["style",[["foreground","red"]]]\uE001g\u{202e}one.\uE002`;
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(
      run(['--file', 'doc.json', 'select', '-F', field], {
        cwd,
        env: { TERM: 'xterm-256color' },
      }),
    ).resolves.toEqual({
      status: 0,
      stderr: `⚠ Field not found: "\uE000["style",[["foreground","red"]]]\uE001g\\u202eone.\uE002". Run jsonkit keys to list the fields.\n`,
      stdout: '{}\n',
    });
  });
});

test('jsonkit prints an empty object when every requested field is missing', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(
      run(['--file', 'doc.json', 'select', '-F', 'gone', '-F', 'lost'], {
        cwd,
        env: { TERM: 'xterm-256color' },
      }),
    ).resolves.toEqual({
      status: 0,
      stderr:
        '⚠ Field not found: "gone". Run jsonkit keys to list the fields.\n⚠ Field not found: "lost". Run jsonkit keys to list the fields.\n',
      stdout: '{}\n',
    });
  });
});

test('jsonkit keeps a repeated field at its first position', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(
      run(['--file', 'doc.json', 'select', '-F', 'name', '-F', 'count', '-F', 'name'], {
        cwd,
      }),
    ).resolves.toEqual({
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
])('jsonkit rejects the empty field name in %j at its position', async (option, position) => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(['select', ...option, '-f', 'doc.json'], { cwd })).resolves.toEqual({
      status: 2,
      stderr: `jsonkit: Option "--field" at ${position}: Expected a nonempty value.\nRun "jsonkit select --help" to see the usage.\n`,
      stdout: '',
    });
  });
});

test('jsonkit requires at least one field for select', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(['--file', 'doc.json', 'select'], { cwd })).resolves.toEqual({
      status: 2,
      stderr:
        'jsonkit: Option "--field" is required. Supply at least one value.\nRun "jsonkit select --help" to see the usage.\n',
      stdout: '',
    });
  });
});

test.each([
  ['[1,2,3]', 'array with 3 items'],
  ['"text"', 'string'],
  ['null', 'null'],
])('jsonkit rejects select on the non-object root %s', async (contents, kind) => {
  await withDocuments({ 'doc.json': contents }, async (cwd) => {
    await expect(run(['--file', 'doc.json', 'select', '-F', 'name'], { cwd })).resolves.toEqual({
      status: 1,
      stderr: `Expected an object at the root; found ${kind}. Supply a document whose root is an object.\n`,
      stdout: '',
    });
  });
});

test.each([
  [['--file', 'doc.json', 'select', '-F', 'name']],
  [['select', '--file', 'doc.json', '-F', 'name']],
  [['select', '-F', 'name', '--file', 'doc.json']],
  [['select', '-F', 'name', '-f', 'doc.json']],
])('jsonkit selects the same fields for the global placement %j', async (args) => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(args, { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: '{\n  "name": "loom"\n}\n',
    });
  });
});

test.each([
  ['nested', 'deep\n'],
  ['nested.deep', 'value\n'],
])('jsonkit lists the keys at the path %s', async (path, stdout) => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(['--file', 'doc.json', 'keys', path], { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout,
    });
  });
});

test('jsonkit lists the root keys when the keys path is omitted', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(['--file', 'doc.json', 'keys'], { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'name\ntags\nnested\ncount\nok\nnone\n',
    });
  });
});

test.each(['missing', 'nested.gone', 'tags.2'])(
  'jsonkit reports the unresolved keys path %s with EX_DATAERR',
  async (path) => {
    await withDocuments({ 'doc.json': document }, async (cwd) => {
      await expect(run(['--file', 'doc.json', 'keys', path], { cwd })).resolves.toEqual({
        status: 65,
        stderr: `Path not found: "${path}". Run jsonkit keys to list the keys at the root.\n`,
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
])('jsonkit rejects the non-object keys path %s', async (path, kind) => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(['--file', 'doc.json', 'keys', path], { cwd })).resolves.toEqual({
      status: 1,
      stderr: `Expected an object at ${path}; found ${kind}. Run jsonkit paths to find the paths that hold objects.\n`,
      stdout: '',
    });
  });
});

test('the inspected graph publishes the text() input schema for --field', async () => {
  const inspected = inspection();
  const graph: {
    root: { children: { name: string; options: { name: string; schema: unknown }[] }[] };
  } = JSON.parse(inspected);
  const found = graph.root.children.find((child) => child.name === 'select');
  expect(found?.options.find((option) => option.name === 'field')?.schema).toEqual({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    minLength: 1,
    type: 'string',
  });
});
