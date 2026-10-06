import { Application, Command } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { json } from '@loomcli/plugins/format/views';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifest } from '@loomcli/plugins/manifest';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { version } from '@loomcli/plugins/version';
import { z } from 'zod';

const dispatch = ({ out }) => out.print('dispatched');

// A test that reads a defect's own sentence runs the fixture as a development build.
const packet =
  process.env.FIXTURE_BUILD === undefined ? {} : { packet: { build: process.env.FIXTURE_BUILD } };

/** The view a result names, so the formatter adds `json`, `jsonl`, and `--format` beside it. */
const text = { render: (value) => `${value}\n` };

/** Every entry rule the manifest states, spread over a small application. */
function application(settings) {
  const get = new Command('get', {
    description: 'Read one value.',
    extensions: [
      manifestCommand({ details: 'Quote a path.' }),
      helpCommand({ details: 'Help prose.', examples: [{ command: 'get b', note: 'B.' }] }),
    ],
  })
    .argument('path', { description: 'The path.', required: true })
    .option('raw', { description: 'Print raw.', env: 'APP_RAW', polarity: 'both', type: 'boolean' })
    .option('debug', { hidden: true, type: 'boolean' })
    .option('limit', {
      default: '10',
      description: 'The limit.',
      env: 'APP_LIMIT',
      short: 'l',
      type: 'string',
      validate: z.string().regex(/^[0-9]+$/u),
    })
    .option('tag', { multiple: true, type: 'string' })
    .option('verbose', { description: 'Say more.', env: 'APP_VERBOSE', short: 'v', type: 'count' })
    .option('backup', { default: 'none', implied: 'simple', type: 'string' })
    .option('mode', { default: undefined, type: 'string', validate: z.string().optional() })
    .action(dispatch)
    .extend(manifestCommand({ examples: [{ command: 'get a' }] }));
  const show = new Command('show', { description: 'Show a value.' })
    .result({ views: { text } })
    .action(({ out }) => out.results('shown'));
  const old = new Command('old', { deprecated: 'Use get instead.' }).action(dispatch);
  const secret = new Command('secret', { description: 'A hidden command.', hidden: true }).action(
    dispatch,
  );
  const clear = new Command('clear', { description: 'Empty the cache.' }).action(dispatch);
  const cache = new Command('cache', { description: 'Manage the cache.' }).command(clear);
  const weird = new Command('weird', {
    description: 'A \u009b control, a \u009f edge, and a \u00a0 space.',
  })
    .option('marked', { default: 'c\uE000\uE001\uE002\uE003d\uE003E000e', type: 'string' })
    .action(dispatch);
  const pick = new Command('pick')
    .argument('index', { default: '0', validate: z.string().regex(/^[0-9]+$/u) })
    .action(dispatch);
  const empty = new Command('empty', { extensions: [manifestCommand({})] }).action(dispatch);
  return new Application('app', {
    description: 'A fixture application.',
    plugins: [help(), version(), format(), manifest(settings)],
    version: '1.2.0',
  })
    .globalOption('file', { description: 'The document.', short: 'f', type: 'string' })
    .globalOption('trace', { hidden: true, type: 'boolean' })
    .command(get)
    .command(show)
    .command(old)
    .command(secret)
    .command(cache)
    .command(weird)
    .command(empty)
    .command(pick)
    .action(dispatch);
}

/** An application whose one option declares a default that JSON cannot carry. */
function defaulted(value) {
  return new Application('app', { ...packet, plugins: [manifest()] })
    .option('odd', { default: value, type: 'string', validate: z.any() })
    .action(dispatch);
}

/** A hand-written validator whose converter publishes what `input` returns. */
function publishing(input) {
  return {
    '~standard': {
      jsonSchema: { input, output: () => ({}) },
      validate: (value) => ({ value }),
      vendor: 'fixture',
      version: 1,
    },
  };
}

/** An application whose one option publishes the schema `input` returns. */
const published = (input) => () =>
  new Application('app', { ...packet, plugins: [manifest()] })
    .option('odd', { type: 'string', validate: publishing(input) })
    .action(dispatch);

/** A value that holds itself, which no JSON text can carry. */
function looped() {
  const value = { type: 'string' };
  value.self = value;
  return value;
}

/** An application whose non-plain default sits on a global, a child Command's option, or an argument. */
function placed(where, value) {
  const odd = { default: value, type: 'string', validate: z.any() };
  const app = new Application('app', { ...packet, plugins: [manifest()] });
  if (where === 'global') {
    return app.globalOption('odd', odd).action(dispatch);
  }
  if (where === 'argument') {
    return app.argument('odd', { default: value, validate: z.any() }).action(dispatch);
  }
  return app.command(new Command('child').option('odd', odd).action(dispatch)).action(dispatch);
}

/**
 * An application whose `json` key holds a view that declares no media type and whose `wire` key
 * holds a mapped `json()`, so the document reads each encoding from the result, not from a name.
 */
const wired = () =>
  new Application('app', { ...packet, plugins: [format(), manifest()] })
    .result({ views: { json: text, wire: json({ map: (value) => ({ value }) }) } })
    .action(({ out }) => out.results('wired'));

const scenarios = {
  app: application,
  'argument-nan': () => placed('argument', Number.NaN),
  'array-date': () => defaulted([new Date(0)]),
  bigint: () => defaulted(10n),
  'child-nan': () => placed('child', Number.NaN),
  date: () => defaulted(new Date(0)),
  'deep-bigint': () => defaulted({ outer: { inner: 10n } }),
  function: () => defaulted(() => 'ten'),
  'global-nan': () => placed('global', Number.NaN),
  infinity: () => defaulted(Number.POSITIVE_INFINITY),
  map: () => defaulted(new Map()),
  nan: () => defaulted(Number.NaN),
  'null-prototype': () =>
    defaulted(Object.assign(Object.create(null), { plain: [1, { two: null }] })),
  schema: published(() => ({ minimum: Number.NaN, type: 'number' })),
  'schema-cycle': published(looped),
  short: () => application({ short: 'M' }),
  wired,
};

const [scenario, ...argv] = process.argv.slice(2);
// `COLOR=always` forces color and modifiers on, so a test compares the bytes under both settings.
const forced = process.env.COLOR === 'always';
await scenarios[scenario]().run({
  host: { argv },
  ...(forced ? { rendering: { color: 'always', modifiers: 'always' } } : {}),
});
