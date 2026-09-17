import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/format-run.mjs', import.meta.url);
const rejected = new URL('fixtures/format-build.mjs', import.meta.url);

function run(scenario: string, argv: string[]) {
  return invoke(fixture, [scenario, ...argv]);
}

interface InspectedGraph {
  root: { children: { name: string; options: { name: string }[]; result: unknown }[] };
}

function inspect(scenario: string): InspectedGraph {
  const result = invoke(fixture, ['inspect', scenario]);
  expect(result.status).toBe(0);
  const graph: InspectedGraph = JSON.parse(result.stdout);
  return graph;
}

test('an author-declared json view is kept with its own map and its declared position', () => {
  const graph = inspect('author-json');
  const found = graph.root.children.find((child) => child.name === 'count');
  expect(found?.result).toEqual({
    default: 'json',
    kind: 'value',
    views: ['json', 'table', 'jsonl'],
  });
  // The default view is the author's json, so an omitted --format renders through its own map.
  expect(run('author-json', ['count'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{\n  "label": "a"\n}\n',
  });
  expect(run('author-json', ['count', '--format', 'jsonl'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"label":"a","value":1}\n',
  });
});

test('an author-declared ndjson key is not served by the alias, which names it directly', () => {
  const graph = inspect('author-ndjson');
  const found = graph.root.children.find((child) => child.name === 'count');
  expect(found?.result).toEqual({
    default: 'ndjson',
    kind: 'value',
    views: ['ndjson', 'table', 'json', 'jsonl'],
  });
  expect(run('author-ndjson', ['count', '--format', 'ndjson'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'table:a:1\n',
  });
});

test("an omitted --format leaves an earlier plugin's view assignment in place", () => {
  expect(run('earlier-view', ['count'])).toEqual({ status: 0, stderr: '', stdout: 'table:a:1\n' });
});

test('a supplied --format still wins over an earlier plugin, format runs after it', () => {
  expect(run('earlier-view', ['count', '--format', 'json'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{\n  "label": "a",\n  "value": 1\n}\n',
  });
});

test('--format on a Command with no result is the unknown-option error', () => {
  expect(run('no-result', ['count', '--format', 'json'])).toEqual({
    status: 2,
    stderr:
      'Invalid input: Unknown option "--format". Supply a declared option; prefix a hyphenated path with "./".\n',
    stdout: '',
  });
});

test('a no-result Command has no --format row on its help page', () => {
  const graph = inspect('no-result');
  const found = graph.root.children.find((child) => child.name === 'count');
  expect(found?.options).toEqual([]);
  const page = run('no-result', ['count', '--help']);
  expect(page.status).toBe(0);
  expect(page.stdout).not.toContain('--format');
});

test('the hook-collision error names a local option', () => {
  expect(invoke(rejected, ['local-collision'])).toEqual({
    status: 1,
    stderr:
      'Invalid declaration: Plugin "@loomcli/plugins/format" declares option "format" on Command "count", which is already declared as a local option. Rename the Command\'s option or omit the plugin.\n',
    stdout: '',
  });
});

test('the hook-collision error names a global option', () => {
  expect(invoke(rejected, ['global-collision'])).toEqual({
    status: 1,
    stderr:
      'Invalid declaration: Plugin "@loomcli/plugins/format" declares option "format" on Command "count", which is already declared as a global option. Rename the Command\'s option or omit the plugin.\n',
    stdout: '',
  });
});

test("the hook-collision error names another plugin's option", () => {
  expect(invoke(rejected, ['plugin-collision'])).toEqual({
    status: 1,
    stderr:
      'Invalid declaration: Plugin "@loomcli/plugins/format" declares option "format" on Command "count", which is already declared as an option of plugin "@fixture/claimant". Rename the Command\'s option or omit the plugin.\n',
    stdout: '',
  });
});
