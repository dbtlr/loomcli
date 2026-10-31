import { expect, test } from 'vite-plus/test';

import { withDocuments } from './documents.js';
import { inspection, run } from './run.js';

/** A document with one member of every kind the walk reports, in the order it walks them. */
const walked = '{"name":"loom","tags":["a","b"],"ok":true}';

/** The entries the walk of `walked` yields, root first, in the order `paths` prints them. */
const entries = [
  { kind: 'object with 3 keys', path: '.' },
  { kind: 'string', path: 'name' },
  { kind: 'array with 2 items', path: 'tags' },
  { kind: 'string', path: 'tags.0' },
  { kind: 'string', path: 'tags.1' },
  { kind: 'boolean', path: 'ok' },
];

test.each(['--format', '-o'])(
  'jsonkit paths %s jsonl prints one line per Entry',
  async (spelling) => {
    await withDocuments({ 'doc.json': walked }, async (cwd) => {
      const result = await run(['paths', spelling, 'jsonl', '-f', 'doc.json'], { cwd });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe(`${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    });
  },
);

test('jsonkit paths --format ndjson prints the same bytes as jsonl, the unadvertised alias', async () => {
  await withDocuments({ 'doc.json': walked }, async (cwd) => {
    const named = await run(['paths', '--format', 'jsonl', '-f', 'doc.json'], { cwd });
    const aliased = await run(['paths', '--format', 'ndjson', '-f', 'doc.json'], { cwd });
    expect(aliased).toEqual(named);
  });
});

test('jsonkit paths --format json prints one indented array', async () => {
  await withDocuments({ 'doc.json': walked }, async (cwd) => {
    const result = await run(['paths', '--format', 'json', '-f', 'doc.json'], { cwd });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${JSON.stringify(entries, null, 2)}\n`);
  });
});

test('jsonkit get --format json is the unknown-option error, get declares no result', async () => {
  await withDocuments({ 'doc.json': walked }, async (cwd) => {
    const result = await run(['get', '--format', 'json', 'user.name', '-f', 'doc.json'], {
      cwd,
    });
    expect(result).toEqual({
      status: 2,
      stderr:
        'jsonkit: Unknown option "--format". Supply a declared option; prefix a hyphenated path with "./".\nRun "jsonkit get --help" to see the usage.\nRun "jsonkit get --explain" to explain this command.\n',
      stdout: '',
    });
  });
});

test('jsonkit paths --format yaml --help still prints the help page, help installed after format', async () => {
  await withDocuments({ 'doc.json': walked }, async (cwd) => {
    const withHelp = await run(['paths', '--help'], { cwd });
    const result = await run(['paths', '--format', 'yaml', '--help'], { cwd });
    expect(result).toEqual({ status: 0, stderr: '', stdout: withHelp.stdout });
  });
});

test('jsonkit inspect reports formatter views on the root records and paths results', async () => {
  const inspected = inspection();
  expect(inspected.status).toBe(0);
  const graph: { root: { result: unknown; children: { name: string; result: unknown }[] } } =
    JSON.parse(inspected.stdout);
  expect(graph.root.result).toEqual({
    default: 'records',
    kind: 'rows',
    mediaTypes: { json: 'application/json', jsonl: 'application/jsonl', records: null },
    views: ['records', 'json', 'jsonl'],
  });
  const found = graph.root.children.find((child) => child.name === 'paths');
  expect(found?.result).toEqual({
    default: 'list',
    kind: 'rows',
    mediaTypes: { json: 'application/json', jsonl: 'application/jsonl', list: null, table: null },
    views: ['list', 'table', 'json', 'jsonl'],
  });
});

/** A document whose second key the walk refuses, so the sequence stops with rows already written. */
const refused = '{"name":"loom","boom":{"deep":1}}';

test('jsonkit paths --format json -f broken.json writes the invalid-json line alone and exits 65', async () => {
  await withDocuments({ 'broken.json': '{"name":' }, async (cwd) => {
    await expect(run(['paths', '--format', 'json', '-f', 'broken.json'], { cwd })).resolves.toEqual(
      {
        status: 65,
        stderr:
          '{"error":{"code":"invalid-json","exitCode":65,"message":"The document is not valid JSON. Correct its syntax, or supply another document.","hints":[]}}\n',
        stdout: '',
      },
    );
  });
});

test("jsonkit's FatalError override renders the text failure and is not consulted under --format json", async () => {
  await withDocuments({ 'broken.json': '{"name":' }, async (cwd) => {
    await expect(run(['paths', '-f', 'broken.json'], { cwd })).resolves.toEqual({
      status: 65,
      stderr: 'The document is not valid JSON. Correct its syntax, or supply another document.\n',
      stdout: '',
    });
  });
});

// The jsonl() view is a whole view, so core collects the rows and a stopped sequence writes none.
test('jsonkit paths --format jsonl with a refused key writes the fatal line alone, with no incomplete-result line', async () => {
  await withDocuments({ 'doc.json': refused }, async (cwd) => {
    await expect(run(['paths', '--format', 'jsonl', '-f', 'doc.json'], { cwd })).resolves.toEqual({
      status: 1,
      stderr:
        '{"error":{"code":"fatal","exitCode":1,"message":"Cannot walk boom. Remove the \\"boom\\" key from the document.","hints":[]}}\n',
      stdout: '',
    });
  });
});

test('an unknown command under --format json writes its text, because routing reached no result', async () => {
  await withDocuments({ 'doc.json': walked }, async (cwd) => {
    const result = await run(['typo', '--format', 'json', '-f', 'doc.json'], { cwd });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^jsonkit: Unknown command "typo"\./u);
    expect(result.stdout).toBe('');
  });
});
