import { expect, test } from 'vite-plus/test';

import { run as buildRun } from './fixtures/format-build.mjs';
import { run as fixtureRun } from './fixtures/format-run.mjs';
/*
 * Acceptance plan for the formatter plugin (docs/plugins/format.md).
 *
 * The formatter is proven when textstat installs `format({ short: 'f' })` and jsonkit installs
 * `format({ short: 'o' })`, after `help()` and `version()` and ahead of the example plugin, and
 * public APIs alone produce the transcripts that examples/textstat/tests/format.test.ts and
 * examples/jsonkit/tests/format.test.ts pin. This suite and format-views.test.ts cover the rest.
 * Each case runs under Node and Bun. The cases:
 *
 * - Views. Both views under both units with an empty array and with a map, a `bigint` and a
 *   top-level `undefined` as view faults, and U+009B and U+001B inside a string printed as escapes
 *   under `color: 'never'` and `'always'` alike.
 * - Declared views. An author-declared `json` kept with its map and position, and an
 *   author-declared `ndjson` key that the alias no longer serves.
 * - The option. `--format yaml`, `--format` on a no-result Command, `--format` twice and with no
 *   value, an omitted `--format` leaving an earlier plugin's selection in place, and `--format yaml
 *   --help` printing the page.
 * - Collisions. The hook-collision error against a local, a global, and another plugin's `format`.
 *   `format({ short: 'f' })` puts `-f` on the help row and selects a view through it, and its short
 *   spelling collides with a local option's and with help's `-h`.
 *
 * The lifecycle cases live in packages/core/tests/request.test.ts, and the failure encoders' lines
 * in packages/core/tests/failure-encoders.test.ts.
 */
import { run as settingsRun } from './fixtures/format-settings.mjs';

async function run(scenario: string, argv: string[]) {
  return await fixtureRun([scenario, ...argv]);
}

interface InspectedGraph {
  root: {
    children: {
      name: string;
      options: { name: string; schema?: unknown; short?: string | null }[];
      result: unknown;
    }[];
  };
}

async function inspect(scenario: string): Promise<InspectedGraph> {
  const result = await fixtureRun(['inspect', scenario]);
  expect(result.status).toBe(0);
  const graph: InspectedGraph = JSON.parse(result.stdout);
  return graph;
}

test('an author-declared json view is kept with its own map and its declared position', async () => {
  const graph = await inspect('author-json');
  const found = graph.root.children.find((child) => child.name === 'count');
  expect(found?.result).toEqual({
    default: 'json',
    kind: 'value',
    // The author's own json() declares its media type under its own map.
    mediaTypes: { json: 'application/json', jsonl: 'application/jsonl', table: null },
    views: ['json', 'table', 'jsonl'],
  });
  // The default view is the author's json, so an omitted --format renders through its own map.
  await expect(run('author-json', ['count'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{\n  "label": "a"\n}\n',
  });
  await expect(run('author-json', ['count', '--format', 'jsonl'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"label":"a","value":1}\n',
  });
});

test('an author-declared ndjson key is not served by the alias, which names it directly', async () => {
  const graph = await inspect('author-ndjson');
  const found = graph.root.children.find((child) => child.name === 'count');
  expect(found?.result).toEqual({
    default: 'ndjson',
    kind: 'value',
    mediaTypes: { json: 'application/json', jsonl: 'application/jsonl', ndjson: null, table: null },
    views: ['ndjson', 'table', 'json', 'jsonl'],
  });
  await expect(run('author-ndjson', ['count', '--format', 'ndjson'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'table:a:1\n',
  });
});

test("an omitted --format leaves an earlier plugin's view assignment in place", async () => {
  await expect(run('earlier-view', ['count'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'table:a:1\n',
  });
});

test('a supplied --format still wins over an earlier plugin, format runs after it', async () => {
  await expect(run('earlier-view', ['count', '--format', 'json'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{\n  "label": "a",\n  "value": 1\n}\n',
  });
});

test('--format on a Command with no result is the unknown-option error', async () => {
  await expect(run('no-result', ['count', '--format', 'json'])).resolves.toEqual({
    status: 2,
    stderr:
      'app: Unknown option "--format". Supply a declared option; prefix a hyphenated path with "./".\nRun "app count --help" to see the usage.\n',
    stdout: '',
  });
});

test('a no-result Command has no --format row on its help page', async () => {
  const graph = await inspect('no-result');
  const found = graph.root.children.find((child) => child.name === 'count');
  expect(found?.options).toEqual([]);
  const page = await run('no-result', ['count', '--help']);
  expect(page.status).toBe(0);
  expect(page.stdout).not.toContain('--format');
});

test('the hook-collision error names a local option', async () => {
  await expect(buildRun(['local-collision'])).resolves.toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: '',
  });
});

test('the hook-collision error names a global option', async () => {
  await expect(buildRun(['global-collision'])).resolves.toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: '',
  });
});

test("the hook-collision error names another plugin's option", async () => {
  await expect(buildRun(['plugin-collision'])).resolves.toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: '',
  });
});

/** The rule, sentence, and finding notes of the fault one build scenario's inspect() throws. */
async function buildFault(scenario: string): Promise<unknown> {
  const result = await buildRun(['inspect', scenario]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

test('format() gives --format no short spelling by default', async () => {
  const fixtureResult1 = await inspect('later-default');
  const found = fixtureResult1.root.children.find((child) => child.name === 'count');
  expect(found?.options.find((option) => option.name === 'format')?.short).toBeNull();
  const fixtureResult2 = await run('later-default', ['count', '-f', 'json']);
  expect(fixtureResult2.status).toBe(2);
});

test('format({ short }) gives --format that short spelling, and it selects a view', async () => {
  const fixtureResult3 = await inspect('short');
  const found = fixtureResult3.root.children.find((child) => child.name === 'count');
  expect(found?.options.find((option) => option.name === 'format')?.short).toBe('-f');
  await expect(run('short', ['count', '-f', 'json'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{\n  "label": "a",\n  "value": 1\n}\n',
  });
  const fixtureResult4 = await run('short', ['count', '--help']);
  expect(fixtureResult4.stdout).toContain(
    '  -f, --format <format>  Select the output format, table by default.',
  );
});

test("a short spelling the Command's own option holds is the hook-collision error naming both", async () => {
  await expect(buildFault('short-local-collision')).resolves.toEqual({
    notes: ['declared by plugin "@loomcli/plugins/format"', 'the local option "file"'],
    rule: '@loomcli/core/spelling-taken',
    sentence:
      'Plugin "@loomcli/plugins/format" declares option "format" with spelling "-f" on Command "count", which "--file" already uses.',
  });
});

test("a short spelling another plugin's option holds is the hook-collision error naming both", async () => {
  await expect(buildFault('short-help-collision')).resolves.toEqual({
    notes: [
      'declared by plugin "@loomcli/plugins/format"',
      'an option of plugin "@loomcli/plugins/help"',
    ],
    rule: '@loomcli/core/spelling-taken',
    sentence:
      'Plugin "@loomcli/plugins/format" declares option "format" with spelling "-h" on Command "count", which "--help" already uses.',
  });
});

/** The fault a `format()` call throws for settings given as JSON, or `"returned"` when it returns. */
async function callFault(settings: unknown): Promise<Record<string, unknown> | 'returned'> {
  const result = await settingsRun(settings === undefined ? [] : [JSON.stringify(settings)]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

test('format() with no settings, empty settings, or one ASCII letter returns its plugin', async () => {
  await expect(callFault(undefined)).resolves.toBe('returned');
  await expect(callFault({})).resolves.toBe('returned');
  await expect(callFault({ short: 'f' })).resolves.toBe('returned');
  await expect(callFault({ short: 'F' })).resolves.toBe('returned');
});

test('the formatter describes its declared default and publishes the ordered views as its enum, without a parser default', async () => {
  const fixtureResult5 = await inspect('author-json');
  const found = fixtureResult5.root.children.find((child) => child.name === 'count');
  expect(found?.options.find((option) => option.name === 'format')).toMatchObject({
    description: 'Select the output format, json by default.',
    schema: { enum: ['json', 'table', 'jsonl'] },
  });
  expect(found?.options.find((option) => option.name === 'format')).not.toHaveProperty('default');
});

test.each([
  ['earlier-default', 'table, custom, json, jsonl', 'custom'],
  ['later-default', 'table, json, jsonl', 'table'],
  ['author-ndjson', 'ndjson, table, json, jsonl', 'ndjson'],
])(
  'the format description records the hook-time default and its enum the hook-time names: %s',
  async (scenario, names, selected) => {
    const fixtureResult6 = await inspect(scenario);
    const found = fixtureResult6.root.children.find((child) => child.name === 'count');
    expect(found?.options.find((option) => option.name === 'format')).toMatchObject({
      description: `Select the output format, ${selected} by default.`,
      schema: { enum: names.split(', ') },
    });
    expect(found?.options.find((option) => option.name === 'format')).not.toHaveProperty('default');
  },
);

test('a result without the formatter invents no selector or list of views', async () => {
  const fixtureResult7 = await inspect('no-formatter');
  expect(fixtureResult7.root.children[0]?.options).toEqual([]);
  await expect(run('no-formatter', ['count', '--help'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout:
      'app count\n\nUSAGE\n  app count [options]\n\nGLOBAL OPTIONS\n  -h, --help  Show this help.\n',
  });
});

test.each([
  ['later-default', ['table', 'json', 'jsonl']],
  ['author-ndjson', ['ndjson', 'table', 'json', 'jsonl']],
])('--format publishes the enum of the view names alone: %s', async (scenario, names) => {
  const fixtureResult8 = await inspect(scenario);
  const found = fixtureResult8.root.children.find((child) => child.name === 'count');
  expect(found?.options.find((option) => option.name === 'format')).toMatchObject({
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      enum: names,
      type: 'string',
    },
  });
});

test('the unadvertised ndjson alias still maps to jsonl, and a stray name lists the views', async () => {
  await expect(run('later-default', ['count', '--format', 'ndjson'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"label":"a","value":1}\n',
  });
  await expect(run('later-default', ['count', '--format', 'xml'])).resolves.toEqual({
    status: 2,
    stderr:
      'app: Option "--format": Supply one of table, json, jsonl.\nRun "app count --help" to see the usage.\n',
    stdout: '',
  });
});
