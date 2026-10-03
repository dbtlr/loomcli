import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/format-run.mjs', import.meta.url);
const rejected = new URL('fixtures/format-build.mjs', import.meta.url);

function run(scenario: string, argv: string[]) {
  return invoke(fixture, [scenario, ...argv]);
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
      'app: Unknown option "--format". Supply a declared option; prefix a hyphenated path with "./".\nRun "app count --help" to see the usage.\n',
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
    stderr: 'app: Something went wrong.\n',
    stdout: '',
  });
});

test('the hook-collision error names a global option', () => {
  expect(invoke(rejected, ['global-collision'])).toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: '',
  });
});

test("the hook-collision error names another plugin's option", () => {
  expect(invoke(rejected, ['plugin-collision'])).toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: '',
  });
});

/** The rule, sentence, and finding notes of the fault one build scenario's inspect() throws. */
function buildFault(scenario: string): unknown {
  const result = invoke(rejected, ['inspect', scenario]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

test('format() gives --format no short spelling by default', () => {
  const found = inspect('later-default').root.children.find((child) => child.name === 'count');
  expect(found?.options.find((option) => option.name === 'format')?.short).toBeNull();
  expect(run('later-default', ['count', '-f', 'json']).status).toBe(2);
});

test('format({ short }) gives --format that short spelling, and it selects a view', () => {
  const found = inspect('short').root.children.find((child) => child.name === 'count');
  expect(found?.options.find((option) => option.name === 'format')?.short).toBe('-f');
  expect(run('short', ['count', '-f', 'json'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{\n  "label": "a",\n  "value": 1\n}\n',
  });
  expect(run('short', ['count', '--help']).stdout).toContain(
    '  -f, --format <format>  Select the output format, table by default.',
  );
});

test("a short spelling the Command's own option holds is the hook-collision error naming both", () => {
  expect(buildFault('short-local-collision')).toEqual({
    notes: ['declared by plugin "@loomcli/plugins/format"', 'the local option "file"'],
    rule: '@loomcli/core/spelling-taken',
    sentence:
      'Plugin "@loomcli/plugins/format" declares option "format" with spelling "-f" on Command "count", which "--file" already uses.',
  });
});

test("a short spelling another plugin's option holds is the hook-collision error naming both", () => {
  expect(buildFault('short-help-collision')).toEqual({
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
function callFault(settings: unknown): Record<string, unknown> | 'returned' {
  const settingsFixture = new URL('fixtures/format-settings.mjs', import.meta.url);
  const result = invoke(settingsFixture, settings === undefined ? [] : [JSON.stringify(settings)]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

test.each([['fo'], ['-f'], ['1'], [''], ['é'], [5]])(
  'format({ short: %j }) throws the short-alias fault at its own call, naming the plugin',
  (short) => {
    expect(callFault({ short })).toMatchObject({
      correction: 'Supply one ASCII letter.',
      findings: [
        { call: 'format', mark: '0.short', note: 'declared by plugin "@loomcli/plugins/format"' },
      ],
      rule: '@loomcli/core/short-alias',
      sentence: 'Option "format" declares a short alias that is not one ASCII letter.',
    });
  },
);

test("the short-alias fault's diagnostic quotes the format() call and marks short", () => {
  const fault = callFault({ short: 'fo' });
  expect(fault).not.toBe('returned');
  const message = fault === 'returned' ? '' : String(fault.message);
  expect(message).toContain(
    [
      "    format({ short: 'fo' })",
      '             ^^^^^^^^^^^ declared by plugin "@loomcli/plugins/format"',
    ].join('\n'),
  );
  expect(message).not.toContain('option(');
});

test.each([['f'], [5], [null], [['f']]])(
  'format(%j) throws the not-an-object fault at its own call, naming the plugin',
  (settings) => {
    expect(callFault(settings)).toMatchObject({
      correction: 'Supply a settings object, or omit the settings.',
      findings: [
        { call: 'format', mark: '0', note: 'declared by plugin "@loomcli/plugins/format"' },
      ],
      rule: '@loomcli/core/not-an-object',
      sentence: 'Plugin "@loomcli/plugins/format" declares settings that are not an object.',
    });
  },
);

test('format() with no settings, empty settings, or one ASCII letter returns its plugin', () => {
  expect(callFault(undefined)).toBe('returned');
  expect(callFault({})).toBe('returned');
  expect(callFault({ short: 'f' })).toBe('returned');
  expect(callFault({ short: 'F' })).toBe('returned');
});

test('the formatter describes its declared default and publishes the ordered views as its enum, without a parser default', () => {
  const found = inspect('author-json').root.children.find((child) => child.name === 'count');
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
  (scenario, names, selected) => {
    const found = inspect(scenario).root.children.find((child) => child.name === 'count');
    expect(found?.options.find((option) => option.name === 'format')).toMatchObject({
      description: `Select the output format, ${selected} by default.`,
      schema: { enum: names.split(', ') },
    });
    expect(found?.options.find((option) => option.name === 'format')).not.toHaveProperty('default');
  },
);

test('a result without the formatter invents no selector or list of views', () => {
  expect(inspect('no-formatter').root.children[0]?.options).toEqual([]);
  expect(run('no-formatter', ['count', '--help'])).toEqual({
    status: 0,
    stderr: '',
    stdout:
      'app count\n\nUSAGE\n  app count [options]\n\nGLOBAL OPTIONS\n  -h, --help  Show this help.\n',
  });
});

test.each([
  ['later-default', ['table', 'json', 'jsonl']],
  ['author-ndjson', ['ndjson', 'table', 'json', 'jsonl']],
])('--format publishes the enum of the view names alone: %s', (scenario, names) => {
  const found = inspect(scenario).root.children.find((child) => child.name === 'count');
  expect(found?.options.find((option) => option.name === 'format')).toMatchObject({
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      enum: names,
      type: 'string',
    },
  });
});

test('the unadvertised ndjson alias still maps to jsonl, and a stray name lists the views', () => {
  expect(run('later-default', ['count', '--format', 'ndjson'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"label":"a","value":1}\n',
  });
  expect(run('later-default', ['count', '--format', 'xml'])).toEqual({
    status: 2,
    stderr:
      'app: Option "--format": Supply one of table, json, jsonl.\nRun "app count --help" to see the usage.\n',
    stdout: '',
  });
});
