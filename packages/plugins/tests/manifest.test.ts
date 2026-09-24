import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/manifest-run.mjs', import.meta.url);

function run(scenario: string, argv: string[]) {
  return invoke(fixture, [scenario, ...argv]);
}

/** A document the fixture printed, parsed without claiming a shape for it. */
function documentOf(argv: string[]): Record<string, unknown> {
  const result = run('app', argv);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return JSON.parse(result.stdout);
}

/** The Command entry at a path of child names, read from a parsed document's `command`. */
function entryAt(document: Record<string, unknown>, names: string[]): Record<string, unknown> {
  let entry: unknown = document.command;
  for (const name of names) {
    const children: unknown =
      typeof entry === 'object' && entry !== null && 'children' in entry ? entry.children : [];
    entry = Array.isArray(children)
      ? children.find(
          (child: unknown) =>
            typeof child === 'object' && child !== null && 'name' in child && child.name === name,
        )
      : undefined;
  }
  expect(entry).toBeTypeOf('object');
  return Object(entry);
}

const tokens =
  "Every input is a string token. A schema describes the value one token must satisfy, or the whole list of tokens for a multiple option or a variadic argument, and a null schema means the accepted shape is unknown, not that every token is accepted. An example's command holds the tokens after the application name.";

const exitCodes = {
  '0': 'Successful execution and core output',
  '1': 'Expected action failure, internal failure, or invalid declarations',
  '130': 'Cancelled by SIGINT or by a caller-supplied abort',
  '143': 'Cancelled by SIGTERM',
  '2': 'Invalid invocation inputs',
};

const encodings = {
  json: "The output is one JSON document. Unless the Command's view reshapes it, a value result is the value and a rows result is the array of its rows.",
  jsonl:
    'Each line is one JSON document: one line per element when the printed value is an array, nothing for an empty array, and one line otherwise. Unless the view reshapes it, a rows result prints one line per row.',
};

/** A Boolean plugin option's entry, which reads the same for every plugin. */
function plugin(name: string, description: string, short: string | null) {
  return {
    type: 'boolean',
    name,
    description,
    deprecated: null,
    long: `--${name}`,
    short,
    negative: null,
    polarity: 'positive',
    schema: null,
  };
}

const globals = [
  {
    type: 'string',
    name: 'file',
    description: 'The document.',
    deprecated: null,
    long: '--file',
    short: '-f',
    required: false,
    multiple: false,
    schema: null,
    default: null,
  },
  plugin('help', 'Show this help.', '-h'),
  plugin('version', 'Print the version.', '-V'),
  plugin('manifest', "Print this command's manifest as JSON.", null),
];

/** `app get --manifest`, written by hand from the contract's rules, in its key order. */
const getDocument = {
  name: 'app',
  version: '1.2.0',
  description: 'A fixture application.',
  tokens,
  exitCodes,
  encodings,
  globals,
  command: {
    name: 'get',
    path: ['get'],
    description: 'Read one value.',
    details: ['Quote a path.', 'Help prose.'],
    examples: [
      { command: 'get a', note: null },
      { command: 'get b', note: 'B.' },
    ],
    deprecated: null,
    hasAction: true,
    result: null,
    arguments: [
      {
        name: 'path',
        description: 'The path.',
        required: true,
        variadic: false,
        schema: null,
        default: null,
      },
    ],
    options: [
      {
        type: 'boolean',
        name: 'raw',
        description: 'Print raw.',
        deprecated: null,
        long: '--raw',
        short: null,
        negative: '--no-raw',
        polarity: 'both',
        schema: null,
      },
      {
        type: 'string',
        name: 'limit',
        description: 'The limit.',
        deprecated: null,
        long: '--limit',
        short: '-l',
        required: false,
        multiple: false,
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'string',
          pattern: '^[0-9]+$',
        },
        default: { value: '10' },
      },
      {
        type: 'string',
        name: 'tag',
        description: null,
        deprecated: null,
        long: '--tag',
        short: null,
        required: false,
        multiple: true,
        schema: null,
        default: null,
      },
      {
        type: 'string',
        name: 'mode',
        description: null,
        deprecated: null,
        long: '--mode',
        short: null,
        required: false,
        multiple: false,
        schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' },
        default: null,
      },
    ],
    children: [],
  },
};

test('the manifest prints the routed slice as indented JSON in the contract key order, with a missing argument held', () => {
  expect(run('app', ['get', '--manifest'])).toEqual({
    status: 0,
    stderr: '',
    stdout: `${JSON.stringify(getDocument, null, 2)}\n`,
  });
});

test('the root slice lists every visible Command and omits the hidden one', () => {
  const document = documentOf(['--manifest']);
  expect(Object.keys(document)).toEqual([
    'name',
    'version',
    'description',
    'tokens',
    'exitCodes',
    'encodings',
    'globals',
    'command',
  ]);
  const root = entryAt(document, []);
  expect(root).toMatchObject({
    description: 'A fixture application.',
    details: [],
    examples: [],
    hasAction: true,
    name: null,
    path: [],
  });
  expect(entryAt(document, ['get'])).toEqual(getDocument.command);
  const names = Array.isArray(root.children)
    ? root.children.map((child: { name: string }) => child.name)
    : [];
  expect(names).toEqual(['get', 'show', 'old', 'cache', 'weird', 'empty']);
});

test('a result reads kind, views, and default in order, and the formatter option carries its enum', () => {
  const show = entryAt(documentOf(['show', '--manifest']), []);
  expect(show.result).toEqual({ default: 'text', kind: 'value', views: ['text', 'json', 'jsonl'] });
  expect(Object.keys(Object(show.result))).toEqual(['kind', 'views', 'default']);
  expect(show.options).toEqual([
    {
      default: null,
      deprecated: null,
      description: 'Select the output format: text, json, jsonl. Default: text.',
      long: '--format',
      multiple: false,
      name: 'format',
      required: false,
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        enum: ['text', 'json', 'jsonl'],
        type: 'string',
      },
      short: null,
      type: 'string',
    },
  ]);
});

test('a deprecated Command carries its message, and a value with no field adds nothing', () => {
  const document = documentOf(['--manifest']);
  expect(entryAt(document, ['old']).deprecated).toBe('Use get instead.');
  expect(entryAt(document, ['empty'])).toMatchObject({ details: [], examples: [] });
});

test('a hidden Command routed to directly prints its own slice, and a group prints its children', () => {
  expect(entryAt(documentOf(['secret', '--manifest']), [])).toMatchObject({
    description: 'A hidden command.',
    name: 'secret',
  });
  expect(entryAt(documentOf(['cache', '--manifest']), [])).toMatchObject({
    children: [{ description: 'Empty the cache.', name: 'clear', path: ['cache', 'clear'] }],
    hasAction: false,
    name: 'cache',
  });
});

test('a C1 control in a description prints as its escape', () => {
  const result = run('app', ['weird', '--manifest']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(String.raw`"description": "A \u009b control."`);
  expect(result.stdout).not.toContain('\u009b');
});

test('an unknown Command still fails in routing, and an earlier takeover wins', () => {
  expect(run('app', ['nope', '--manifest'])).toMatchObject({ status: 2, stdout: '' });
  expect(run('app', ['--help', '--manifest']).stdout).toMatch(/^app · A fixture application\./u);
  expect(run('app', ['--version', '--manifest'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v1.2.0\n',
  });
});

test('a --manifest token after the passthrough delimiter is not read as the option', () => {
  expect(run('app', ['get', 'x', '--', '--manifest'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'dispatched\n',
  });
});

test('a declared default that is not plain JSON data fails the write', () => {
  for (const scenario of ['bigint', 'nan', 'function']) {
    expect(run(scenario, ['--manifest'])).toEqual({
      status: 1,
      stderr:
        'Internal error: The manifest cannot encode the default of option "--odd" as JSON. Declare a default that is null, a Boolean, a finite number, a string, or an array or plain object of these.\n',
      stdout: '',
    });
  }
});
