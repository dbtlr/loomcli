import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/manifest-run.mjs', import.meta.url);

function run(scenario: string, argv: string[]) {
  return invoke(fixture, [scenario, ...argv]);
}

/** A Command entry as these tests walk it: its name and children, every other field kept as it is. */
interface Entry {
  readonly [field: string]: unknown;
  readonly children: readonly Entry[];
  readonly name: string | null;
}

const entrySchema: z.ZodType<Entry> = z.lazy(() =>
  z.looseObject({ children: z.array(entrySchema), name: z.string().nullable() }),
);

const printedSchema = z.looseObject({ command: entrySchema });

/** The raw document text one invocation printed, after checking that it succeeded. */
function printed(argv: string[]): string {
  const result = run('app', argv);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return result.stdout;
}

/** A document the fixture printed, parsed at the boundary into the fields these tests walk. */
function documentOf(argv: string[]) {
  return printedSchema.parse(JSON.parse(printed(argv)));
}

/** The Command entry at a path of child names under a parsed document's `command`. */
function entryAt(document: z.infer<typeof printedSchema>, names: readonly string[]): Entry {
  let entry = document.command;
  for (const name of names) {
    const child = entry.children.find((candidate) => candidate.name === name);
    if (child === undefined) {
      throw new Error(`The document holds no child "${name}".`);
    }
    entry = child;
  }
  return entry;
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
  const text = printed(['--manifest']);
  const raw: unknown = JSON.parse(text);
  expect(Object.keys(Object(raw))).toEqual([
    'name',
    'version',
    'description',
    'tokens',
    'exitCodes',
    'encodings',
    'globals',
    'command',
  ]);
  const document = printedSchema.parse(raw);
  const root = entryAt(document, []);
  expect(root).toMatchObject({
    name: null,
    path: [],
    description: 'A fixture application.',
    details: [],
    examples: [],
    hasAction: true,
  });
  expect(entryAt(document, ['get'])).toEqual(getDocument.command);
  expect(root.children.map((child) => child.name)).toEqual([
    'get',
    'show',
    'old',
    'cache',
    'weird',
    'empty',
    'pick',
  ]);
});

test('a result reads kind, views, and default in order, and the formatter option carries its enum', () => {
  const show = entryAt(documentOf(['show', '--manifest']), []);
  expect(show.result).toEqual({ default: 'text', kind: 'value', views: ['text', 'json', 'jsonl'] });
  expect(Object.keys(Object(show.result))).toEqual(['kind', 'views', 'default']);
  expect(show.options).toEqual([
    {
      default: null,
      deprecated: null,
      description: 'Select the output format, text by default.',
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

test('marker characters print exactly, C1 controls escape up to U+009F, and U+00A0 stays raw', () => {
  const text = printed(['weird', '--manifest']);
  expect(text).toContain('"description": "A \\u009b control, a \\u009f edge, and a \u00a0 space."');
  expect(text).not.toContain('\u009b');
  expect(entryAt(printedSchema.parse(JSON.parse(text)), []).options).toEqual([
    {
      type: 'string',
      name: 'marked',
      description: null,
      deprecated: null,
      long: '--marked',
      short: null,
      required: false,
      multiple: false,
      schema: null,
      default: { value: 'c\uE000\uE001\uE002\uE003d\uE003E000e' },
    },
  ]);
});

test('the bytes are the same with color and modifiers forced on', () => {
  const plain = run('app', ['get', '--manifest']);
  const forced = invoke(fixture, ['app', 'get', '--manifest'], { env: { COLOR: 'always' } });
  expect(forced).toEqual(plain);
});

test('an argument entry carries its schema and default, and an absent description reads null', () => {
  expect(entryAt(documentOf(['pick', '--manifest']), []).arguments).toEqual([
    {
      name: 'index',
      description: null,
      required: false,
      variadic: false,
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'string',
        pattern: '^[0-9]+$',
      },
      default: { value: '0' },
    },
  ]);
  expect(entryAt(documentOf(['--manifest']), ['empty']).description).toBeNull();
});

test('an unknown Command still fails in routing, and an earlier takeover wins', () => {
  expect(run('app', ['nope', '--manifest'])).toEqual({
    status: 2,
    stderr:
      'Invalid input: Unknown command "nope". Use one of: get, show, old, cache, weird, empty, pick.\n',
    stdout: '',
  });
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

/** The report one unencodable input produces, named by the field that holds the value. */
function unencodable(field: string): { status: number; stderr: string; stdout: string } {
  return {
    status: 1,
    stderr: `Internal error: The manifest cannot encode ${field} as JSON. Supply a value that is null, a Boolean, a finite number, a string, or an array or plain object of these.\n`,
    stdout: '',
  };
}

test('a declared default that is not plain JSON data fails the write, wherever the input sits', () => {
  for (const scenario of [
    'bigint',
    'nan',
    'function',
    'infinity',
    'date',
    'map',
    'array-date',
    'deep-bigint',
    'global-nan',
    'child-nan',
  ]) {
    expect(run(scenario, ['--manifest'])).toEqual(unencodable('the default of option "--odd"'));
  }
  expect(run('argument-nan', ['--manifest'])).toEqual(unencodable('the default of argument "odd"'));
});

test('a null-prototype default prints as the plain object core copies it into, and an absent description reads null', () => {
  const result = run('null-prototype', ['--manifest']);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  const document = printedSchema.parse(JSON.parse(result.stdout));
  expect(document.description).toBeNull();
  expect(entryAt(document, []).description).toBeNull();
  expect(entryAt(document, []).options).toMatchObject([
    { name: 'odd', default: { value: { plain: [1, { two: null }] } } },
  ]);
});

test('a published schema that is not plain JSON data fails the write', () => {
  expect(run('schema', ['--manifest'])).toEqual(unencodable('the schema of option "--odd"'));
});
