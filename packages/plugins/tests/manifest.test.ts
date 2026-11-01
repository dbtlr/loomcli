/*
 * Acceptance plan for the manifest plugin (docs/plugins/manifest.md).
 *
 * The manifest is proven when both example applications install `manifest({ short: 'M' })` after
 * their formatter and ahead of the example plugin, and public APIs alone produce these results
 * under Node and Bun:
 *
 * - Pinned documents. `textstat --manifest`, `jsonkit --manifest`, and `jsonkit get --manifest`
 *   print documents compared byte for byte. `jsonkit get`'s `details` holds the author's value
 *   ahead of help's. `jsonkit fetch --manifest` shows the deprecated Command's message. `jsonkit
 *   debug --manifest` prints the hidden Command's own slice, and the root document omits it.
 * - An agent-shaped run. A test reads the fixture's `--manifest` alone, builds an invocation from
 *   it by choosing the Command with a result and `--format json` from the option's schema enum and
 *   the result's views, runs it, and parses stdout as the `json` encoding states.
 * - Help pages. Every help page lists the `--manifest` row among its options, and the golden pages
 *   are re-pinned for it.
 * - Short spellings. `textstat -M`, `jsonkit -M`, and `jsonkit get -M` print the same documents as
 *   their long forms. A fixture proves no short spelling by default, either case of an ASCII letter
 *   accepted, and collisions with an application global, a local option, and another plugin
 *   reported under the ordinary spelling-taken rule.
 * - Takeover and precedence. `jsonkit get --manifest` without its required argument prints with
 *   exit 0, and so does `--manifest` on a group in a fixture application. An unknown Command still
 *   reports its routing error. `jsonkit --help --manifest` prints help and `jsonkit --version
 *   --manifest` prints the version. A `--manifest` token after `--` is not read as the option.
 * - Entries. Fixture applications cover: a hidden option and a hidden global omitted. An explicit
 *   `default: undefined` reads `null`. Two `manifestCommand` values with `details` produce two
 *   strings in collection order, and a value with neither field adds nothing. A U+009B inside a
 *   description prints as `\u009b`. A declared `bigint`, `NaN`, or function default, and a
 *   published schema holding `NaN`, fail the write. Keys follow the type block's order, `result`
 *   included, and no version field appears.
 * - Declared failures. jsonkit declares `invalid-json` on every Command that reads a document and
 *   `path-not-found` on `get`, `keys`, and the deprecated `fetch`, which runs `get`'s action, all
 *   65, and `jsonkit get --manifest` prints the document above byte for byte, with the `65` row
 *   between `2` and `130`. A malformed document given to each Command that declares `invalid-json`
 *   exits 65, the code its manifest lists. Fixture applications cover: a Command with no declared
 *   failures reading `[]`; a class that declares no exit code listing 1 with no row added; a
 *   `FatalError` subclass that declares no failure code listing `fatal`; one failure code declared
 *   on two Commands with one exit code and meaning listed on both with one row; one failure code
 *   with two exit codes, and with two meanings, reporting its `DeclarationError`; an author value
 *   and a plugin's `onCommandAttach` value concatenated in collection order, with an identical pair
 *   printed once; a hidden Command's code joining the table; a value holding a function that is not
 *   a failure class and a meaning with a line break each rejected at the call; a stale `name`
 *   dropped from the entry; and a failure class whose static `code` is `'Bad_Code'` rejected at the
 *   call.
 * - Control options and media types. Every option entry carries `control`, `true` on `--help`,
 *   `--version`, `--manifest`, and `--format` and `false` on jsonkit's own options, and every
 *   `result` carries `mediaTypes`. A fixture whose `json` key holds a view that declares no media
 *   type, and whose `wire` key holds a mapped `json()`, reads its media types from the result, and
 *   the pinned documents are re-pinned for both fields.
 * - Packed consumers. A consumer installs the packed pack, imports `@loomcli/plugins/manifest` and
 *   `@loomcli/plugins/manifest/extension`, compiles against their declarations, and runs its chosen
 *   `-M`.
 */

import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { run as fixtureRun } from './fixtures/manifest-run.js';
import { run as settingsRun } from './fixtures/manifest-settings.mjs';

async function run(scenario: string, argv: string[], env: Record<string, string> = {}) {
  return await fixtureRun([scenario, ...argv], env);
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
async function printed(argv: string[]) {
  const result = await run('app', argv);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return result.stdout;
}

/** A document the fixture printed, parsed at the boundary into the fields these tests walk. */
async function documentOf(argv: string[]) {
  return printedSchema.parse(JSON.parse(await printed(argv)));
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
  "Every input is a string token. An input's schema describes the value one token must satisfy, and each token of a multiple option or a variadic argument satisfies it alone. The configuration schema describes the configuration the application reads, not a token. A null schema means the accepted shape is unknown, not that every token is accepted. An example's command holds the tokens after the application name.";

const exitCodes = {
  '0': 'Successful execution and core output',
  '1': 'Expected action failure, internal failure, or invalid declarations',
  '129': 'Cancelled by SIGHUP',
  '130': "Cancelled by SIGINT, a caller-supplied abort, or the action's cancel()",
  '131': 'Cancelled by SIGQUIT',
  '141': 'Stopped because the reader of stdout closed the pipe',
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
    control: true,
    long: `--${name}`,
    short,
    negative: null,
    polarity: 'positive',
    interaction: false,
    color: false,
    schema: null,
    env: [],
  };
}

const globals = [
  {
    type: 'string',
    name: 'file',
    description: 'The document.',
    deprecated: null,
    control: false,
    long: '--file',
    short: '-f',
    required: false,
    requiredWhen: null,
    multiple: false,
    schema: null,
    env: [],
    envDelimiter: null,
    envAllowEmpty: false,
    default: null,
    implied: null,
    background: false,
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
  configuration: null,
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
    failures: [],
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
    optionGroups: [],
    options: [
      {
        type: 'boolean',
        name: 'raw',
        description: 'Print raw.',
        deprecated: null,
        control: false,
        long: '--raw',
        short: null,
        negative: '--no-raw',
        polarity: 'both',
        interaction: false,
        color: false,
        schema: null,
        env: ['APP_RAW'],
      },
      {
        type: 'string',
        name: 'limit',
        description: 'The limit.',
        deprecated: null,
        control: false,
        long: '--limit',
        short: '-l',
        required: false,
        requiredWhen: null,
        multiple: false,
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'string',
          pattern: '^[0-9]+$',
        },
        env: ['APP_LIMIT', 'APP_LIMIT_FALLBACK'],
        envDelimiter: null,
        envAllowEmpty: true,
        default: { value: '10' },
        implied: null,
        background: false,
      },
      {
        type: 'string',
        name: 'tag',
        description: null,
        deprecated: null,
        control: false,
        long: '--tag',
        short: null,
        required: false,
        requiredWhen: null,
        multiple: true,
        schema: null,
        env: ['APP_TAGS'],
        envDelimiter: ',',
        envAllowEmpty: false,
        default: null,
        implied: null,
        background: false,
      },
      {
        type: 'count',
        name: 'verbose',
        description: 'Say more.',
        deprecated: null,
        control: false,
        long: '--verbose',
        short: '-v',
        verbose: false,
        quiet: false,
        schema: null,
        env: ['APP_VERBOSE'],
      },
      {
        type: 'string',
        name: 'backup',
        description: null,
        deprecated: null,
        control: false,
        long: '--backup',
        short: null,
        required: false,
        requiredWhen: null,
        multiple: false,
        schema: null,
        env: [],
        envDelimiter: null,
        envAllowEmpty: false,
        default: { value: 'none' },
        implied: 'simple',
        background: false,
      },
      {
        type: 'string',
        name: 'mode',
        description: null,
        deprecated: null,
        control: false,
        long: '--mode',
        short: null,
        required: false,
        requiredWhen: null,
        multiple: false,
        schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' },
        env: [],
        envDelimiter: null,
        envAllowEmpty: false,
        default: null,
        implied: null,
        background: false,
      },
    ],
    children: [],
  },
};

test('the manifest prints the routed slice as indented JSON in the contract key order, with a missing argument held', async () => {
  await expect(run('app', ['get', '--manifest'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${JSON.stringify(getDocument, null, 2)}\n`,
  });
});

test('the envelope carries the configuration fact after globals: null without a source, and the schema a source publishes', async () => {
  const fixtureResult1 = await run('app', ['--manifest']);
  expect(JSON.parse(fixtureResult1.stdout).configuration).toBeNull();
  const { stdout } = await run('configured', ['--manifest']);
  const document = JSON.parse(stdout);
  expect(document.configuration).toEqual({
    schema: { properties: { retries: { type: 'integer' } }, type: 'object' },
  });
  expect(Object.keys(document)).toEqual([
    'name',
    'version',
    'description',
    'tokens',
    'exitCodes',
    'encodings',
    'globals',
    'configuration',
    'command',
  ]);
});

test('manifest({ short }) prints the routed slice through its chosen short spelling', async () => {
  const result = await run('short', ['get', '-M']);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(result).toEqual(await run('short', ['get', '--manifest']));
  expect(printedSchema.parse(JSON.parse(result.stdout)).command.name).toBe('get');
  expect(result.stdout).toContain('"short": "-M"');
});

test('manifest() declares no short spelling by default', async () => {
  await expect(run('app', ['get', '-M'])).resolves.toMatchObject({ status: 2, stdout: '' });
  await expect(run('app', ['get', '--manifest'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${JSON.stringify(getDocument, null, 2)}\n`,
  });
});

/** The factory or declaration fault observed through a process running the public API. */
async function settingsOutcome(mode: string, value?: string) {
  const result = await settingsRun(value === undefined ? [mode] : [mode, value]);
  return JSON.parse(result.stdout);
}

test('manifest accepts omitted or empty settings and either case of ASCII letter', async () => {
  await expect(settingsOutcome('settings')).resolves.toBe('returned');
  for (const settings of [{}, { short: 'm' }, { short: 'M' }]) {
    await expect(settingsOutcome('settings', JSON.stringify(settings))).resolves.toBe('returned');
  }
});

test.each(['global', 'local', 'plugin'])(
  'the manifest short spelling colliding with a %s option reports the ordinary spelling-taken rule',
  async (owner) => {
    await expect(settingsOutcome('collision', owner)).resolves.toMatchObject({
      rule: '@loomcli/core/spelling-taken',
      sentence: expect.stringContaining(owner === 'plugin' ? '-h' : '-M'),
    });
  },
);

test('the root slice lists every visible Command and omits the hidden one', async () => {
  const text = await printed(['--manifest']);
  const raw: unknown = JSON.parse(text);
  expect(Object.keys(Object(raw))).toEqual([
    'name',
    'version',
    'description',
    'tokens',
    'exitCodes',
    'encodings',
    'globals',
    'configuration',
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

test('a result reads kind, views, default, and media types in order, and the formatter option carries its enum and its control mark', async () => {
  const show = entryAt(await documentOf(['show', '--manifest']), []);
  expect(show.result).toEqual({
    default: 'text',
    kind: 'value',
    mediaTypes: { json: 'application/json', jsonl: 'application/jsonl', text: null },
    views: ['text', 'json', 'jsonl'],
  });
  expect(Object.keys(Object(show.result))).toEqual(['kind', 'views', 'default', 'mediaTypes']);
  expect(show.options).toEqual([
    {
      background: false,
      control: true,
      default: null,
      deprecated: null,
      description: 'Select the output format, text by default.',
      envDelimiter: null,
      envAllowEmpty: false,
      env: [],
      implied: null,
      long: '--format',
      multiple: false,
      name: 'format',
      required: false,
      requiredWhen: null,
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

test('a result reads each encoding from the media types its views declare, never from a view name', async () => {
  const result = await run('wired', ['--manifest']);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  const document: { encodings: unknown; command: { result: unknown } } = JSON.parse(result.stdout);
  expect(document.encodings).toEqual(encodings);
  expect(document.command.result).toEqual({
    kind: 'value',
    views: ['json', 'wire', 'jsonl'],
    default: 'json',
    mediaTypes: { json: null, wire: 'application/json', jsonl: 'application/jsonl' },
  });
});

test('a deprecated Command carries its message, and a value with no field adds nothing', async () => {
  const document = await documentOf(['--manifest']);
  expect(entryAt(document, ['old']).deprecated).toBe('Use get instead.');
  expect(entryAt(document, ['empty'])).toMatchObject({ details: [], examples: [] });
});

test('a line break in a description or a deprecation message prints as one space', async () => {
  const result = await run('multiline', ['fetch', '--manifest']);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  const document = printedSchema.parse(JSON.parse(result.stdout));
  expect(document.description).toBe('Do the work.');
  const fetch = entryAt(document, []);
  expect(fetch).toMatchObject({
    arguments: [{ description: 'The path.', name: 'path' }],
    deprecated: 'Use get instead.',
    description: 'Read one value at a path.',
    options: [{ deprecated: 'Use --level.', description: 'How deep to walk.', name: 'depth' }],
  });
});

test('a hidden Command routed to directly prints its own slice, and a group prints its children', async () => {
  expect(entryAt(await documentOf(['secret', '--manifest']), [])).toMatchObject({
    description: 'A hidden command.',
    name: 'secret',
  });
  expect(entryAt(await documentOf(['cache', '--manifest']), [])).toMatchObject({
    children: [{ description: 'Empty the cache.', name: 'clear', path: ['cache', 'clear'] }],
    hasAction: false,
    name: 'cache',
  });
});

test('marker characters print exactly, C1 controls escape up to U+009F, and U+00A0 stays raw', async () => {
  const text = await printed(['weird', '--manifest']);
  expect(text).toContain('"description": "A \\u009b control, a \\u009f edge, and a \u00a0 space."');
  expect(text).not.toContain('\u009b');
  expect(entryAt(printedSchema.parse(JSON.parse(text)), []).options).toEqual([
    {
      type: 'string',
      name: 'marked',
      description: null,
      deprecated: null,
      control: false,
      long: '--marked',
      short: null,
      required: false,
      requiredWhen: null,
      multiple: false,
      schema: null,
      env: [],
      envDelimiter: null,
      envAllowEmpty: false,
      default: { value: 'c\uE000\uE001\uE002\uE003d\uE003E000e' },
      implied: null,
      background: false,
    },
  ]);
});

test('the bytes are the same with color and modifiers forced on', async () => {
  const plain = await run('app', ['get', '--manifest']);
  const forced = await fixtureRun(['app', 'get', '--manifest'], { COLOR: 'always' });
  expect(forced).toEqual(plain);
});

test('an argument entry carries its schema and default, and an absent description reads null', async () => {
  expect(entryAt(await documentOf(['pick', '--manifest']), []).arguments).toEqual([
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
  expect(entryAt(await documentOf(['--manifest']), ['empty']).description).toBeNull();
});

test('an unknown Command still fails in routing, and an earlier takeover wins', async () => {
  await expect(run('app', ['nope', '--manifest'])).resolves.toEqual({
    status: 2,
    stderr:
      'app: Unknown command "nope". Use one of: get, show, cache, weird, empty, pick.\nRun "app --help" to see the usage.\n',
    stdout: '',
  });
  const fixtureResult2 = await run('app', ['--help', '--manifest']);
  expect(fixtureResult2.stdout).toMatch(/^app · A fixture application\./u);
  await expect(run('app', ['--version', '--manifest'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v1.2.0\n',
  });
});

test('a --manifest token after the passthrough delimiter is not read as the option', async () => {
  await expect(run('app', ['get', 'x', '--', '--manifest'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'dispatched\n',
  });
});

/** One unencodable input's report in each build, so a test compares both at once. */
async function unencodable(scenario: string) {
  const fixtureResult3 = await run(scenario, ['--manifest'], { FIXTURE_BUILD: 'development' });
  return {
    development: fixtureResult3.stderr,
    distributed: await run(scenario, ['--manifest']),
  };
}

/**
 * An unencodable input is a defect: a distributed build writes the generic message, and a
 * development build states the sentence that names the field that holds the value.
 */
function reportedAs(field: string) {
  return {
    development: expect.stringContaining(
      `\n\nThe manifest cannot encode ${field} as JSON. Supply a value that is null, a Boolean, a finite number, a string, or an array or plain object of these.\n`,
    ),
    distributed: { status: 1, stderr: 'app: Something went wrong.\n', stdout: '' },
  };
}

test('a declared default that is not plain JSON data fails the write, wherever the input sits', async () => {
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
    await expect(unencodable(scenario)).resolves.toEqual(
      reportedAs('the default of option "--odd"'),
    );
  }
  await expect(unencodable('argument-nan')).resolves.toEqual(
    reportedAs('the default of argument "odd"'),
  );
});

test('a null-prototype default prints as a plain object, and an absent description reads null', async () => {
  const result = await run('null-prototype', ['--manifest']);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  const document = printedSchema.parse(JSON.parse(result.stdout));
  expect(document.description).toBeNull();
  expect(entryAt(document, []).description).toBeNull();
  expect(entryAt(document, []).options).toMatchObject([
    { name: 'odd', default: { value: { plain: [1, { two: null }] } } },
  ]);
});

test('a published schema that is not plain JSON data fails the write', async () => {
  await expect(unencodable('schema')).resolves.toEqual(reportedAs('the schema of option "--odd"'));
  await expect(unencodable('schema-cycle')).resolves.toEqual(
    reportedAs('the schema of option "--odd"'),
  );
});

test('a configuration schema that is not plain JSON data fails the write', async () => {
  await expect(unencodable('configuration-nan')).resolves.toEqual(
    reportedAs('the configuration schema'),
  );
});

const agentSchema = z.object({
  command: z.object({
    children: z.array(
      z.object({
        name: z.string(),
        options: z.array(
          z.object({
            long: z.string().nullable(),
            name: z.string(),
            schema: z.object({ enum: z.array(z.string()).optional() }).nullable(),
          }),
        ),
        result: z.object({ kind: z.string(), views: z.array(z.string()) }).nullable(),
      }),
    ),
  }),
  encodings: z.object({ json: z.string() }),
});

test('an agent builds a valid invocation from the manifest alone and parses the promised encoding', async () => {
  const document = agentSchema.parse(JSON.parse(await printed(['--manifest'])));
  // The agent picks the Command that has a result, and the json view from the result's views.
  const show = document.command.children.find((child) => child.result !== null);
  const format = show?.options.find((option) => option.name === 'format');
  expect(show?.result).toMatchObject({ kind: 'value' });
  expect(show?.result?.views).toContain('json');
  expect(format?.schema?.enum).toContain('json');
  const result = await run('app', [show?.name ?? '', format?.long ?? '', 'json']);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  // A value result under json is the value as one JSON document, as `encodings.json` states.
  expect(document.encodings.json).toContain('a value result is the value');
  expect(JSON.parse(result.stdout)).toBe('shown');
});
