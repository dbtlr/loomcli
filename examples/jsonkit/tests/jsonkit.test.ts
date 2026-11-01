/*
 * Jsonkit's tests show how its declaration assembles Loom's parts, one case for each capability
 * its README lists: nested Commands, plugin Commands, verbosity, content inputs, results and
 * sequences, declared failures, and every first-party projection. The packages prove each rule;
 * these cases prove the assembly and teach it.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertAssembles, mockProcess } from '@loomcli/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';

import { jsonkit } from '../src/application.js';

/*
 * The source imports `get.md` as text, which only Loom's bundler and Bun resolve, so the test
 * supplies the same text from the file.
 */
vi.mock('../src/commands/get.md', async () => {
  const { readFileSync } = await import('node:fs');
  return { default: readFileSync(new URL('../src/commands/get.md', import.meta.url), 'utf8') };
});

/** The folder each run starts in, holding `doc.json` and the malformed `broken.json`. */
let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'loom-jsonkit-'));
  writeFileSync(
    join(directory, 'doc.json'),
    '{"name":"loom","tags":["a","b"],"nested":{"deep":{"value":"found"}}}',
  );
  writeFileSync(join(directory, 'broken.json'), '{"name":');
});

afterEach(() => {
  rmSync(directory, { force: true, recursive: true });
});

/** Runs jsonkit in this process from the test's folder, with the stdin a case pipes. */
async function run(argv: string[], stdin = '') {
  const mock = mockProcess({ argv, cwd: directory, env: { HOME: directory }, stdin });
  const status = await jsonkit.run({ process: mock });
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

test('jsonkit assembles with no fault', () => {
  expect(() => {
    assertAssembles(jsonkit);
  }).not.toThrow();
});

test('each modular Command reads the document from --file or from piped text', async () => {
  await expect(run(['get', 'nested.deep.value', '-f', 'doc.json'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '"found"\n',
  });
  await expect(run(['keys'], '{"b":1,"a":2}')).resolves.toMatchObject({ stdout: 'b\na\n' });
  await expect(
    run(['select', '--field', 'name', '-F', 'missing', '-f', 'doc.json']),
  ).resolves.toMatchObject({
    status: 0,
    stderr: expect.stringContaining('missing'),
    stdout: expect.stringContaining('"name": "loom"'),
  });
});

test('an alias, a deprecated Command, and a path three levels deep all route', async () => {
  const keys = await run(['keys', '-f', 'doc.json']);
  await expect(run(['ls', '-f', 'doc.json'])).resolves.toEqual(keys);
  await expect(run(['fetch', 'name', '-f', 'doc.json'])).resolves.toMatchObject({
    stdout: '"loom"\n',
  });
  await expect(run(['stats', 'depth', 'max', '-f', 'doc.json'])).resolves.toMatchObject({
    status: 0,
    stdout: '3\n',
  });
});

test('an unknown Command lists the visible ones, leaving out hidden and deprecated Commands', async () => {
  const { status, stderr } = await run(['typo', '-f', 'doc.json']);
  expect(status).toBe(2);
  expect(stderr).toContain(
    'Use one of: doctor, completion, mcp, manpage, get, keys, select, stats.',
  );
});

test("the doctor plugin's Command runs at the root without a document", async () => {
  await expect(run(['doctor'])).resolves.toMatchObject({ status: 0 });
});

test('the verbose plugin decides whether the reader’s debug line prints', async () => {
  await expect(run(['-v', 'keys', '-f', 'doc.json'])).resolves.toMatchObject({
    stderr: expect.stringContaining('Reading doc.json.'),
  });
  await expect(run(['keys', '-f', 'doc.json'])).resolves.toMatchObject({ stderr: '' });
});

test('the root result prints records, and the formatter turns it into JSON', async () => {
  const { stderr, stdout } = await run(['-f', 'doc.json']);
  expect(stderr).toContain('object with 3 keys');
  expect(stdout).toContain('name');
  const json = await run(['--format', 'json', '-f', 'doc.json']);
  expect(JSON.parse(json.stdout)).toContainEqual({ key: 'tags', kind: 'array with 2 items' });
});

test('the hidden paths sequence writes one JSON line per path through the formatter', async () => {
  const { status, stdout } = await run(['paths', '-o', 'jsonl', '-f', 'doc.json']);
  expect(status).toBe(0);
  const rows = stdout
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(rows).toContainEqual({ kind: 'string', path: 'nested.deep.value' });
});

test('a declared failure and a translated SyntaxError each exit 65 through the FatalError view', async () => {
  await expect(run(['get', 'missing', '-f', 'doc.json'])).resolves.toEqual({
    status: 65,
    stderr: 'Path not found: "missing". Run jsonkit keys to list the keys at the root.\n',
    stdout: '',
  });
  await expect(run(['get', 'name', '-f', 'broken.json'])).resolves.toEqual({
    status: 65,
    stderr: 'The document is not valid JSON. Correct its syntax, or supply another document.\n',
    stdout: '',
  });
});

test('help prints the details get.md carries, and version the declared version', async () => {
  const help = await run(['get', '--help']);
  expect(help.stdout).toContain('A path is a dot-separated walk from the root of the document.');
  await expect(run(['--version'])).resolves.toMatchObject({ stdout: 'jsonkit v0.0.0\n' });
});

test('the example plugin explains the routed Command without reading a document', async () => {
  await expect(run(['get', '--explain'])).resolves.toMatchObject({
    status: 0,
    stdout: expect.stringContaining('get'),
  });
});

test('the manifest and inspect() describe the graph, without the hidden Commands', async () => {
  const { stdout } = await run(['--manifest']);
  expect(JSON.parse(stdout)).toMatchObject({ name: 'jsonkit' });
  expect(stdout).not.toContain('"debug"');
  expect(JSON.stringify(jsonkit.inspect())).toContain('"minLength":1');
});

test('completion answers a word three levels below the root', async () => {
  const { stdout } = await run(['completion', '__complete', '--', 'stats', 'depth', 'm']);
  expect(stdout).toContain('max');
});

test('the MCP server lists the document Commands as tools', async () => {
  const requests = [
    {
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
        protocolVersion: '2025-06-18',
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { id: 2, jsonrpc: '2.0', method: 'tools/list' },
  ];
  const { stdout } = await run(
    ['mcp'],
    requests.map((request) => `${JSON.stringify(request)}\n`).join(''),
  );
  expect(stdout).toContain('"stats_depth_max"');
});

test('manpage writes a page for each visible Command, three levels deep included', async () => {
  const folder = join(directory, 'man');
  await expect(run(['manpage', 'generate', '--out', folder])).resolves.toMatchObject({ status: 0 });
  expect(readdirSync(folder)).toEqual(
    expect.arrayContaining(['jsonkit-get.1', 'jsonkit-stats-depth-max.1']),
  );
});
