import { Application, Command } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifest } from '@loomcli/plugins/manifest';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { version } from '@loomcli/plugins/version';
import { z } from 'zod';

const dispatch = ({ out }) => out.print('dispatched');

/** The view a result names, so the formatter adds `json`, `jsonl`, and `--format` beside it. */
const text = { render: (value) => `${value}\n` };

/** Every entry rule the manifest states, spread over a small application. */
function application() {
  const get = new Command('get', {
    description: 'Read one value.',
    extensions: [
      manifestCommand({ details: 'Quote a path.' }),
      helpCommand({ details: 'Help prose.', examples: [{ command: 'get b', note: 'B.' }] }),
    ],
  })
    .argument('path', { description: 'The path.', required: true })
    .option('raw', { description: 'Print raw.', polarity: 'both', type: 'boolean' })
    .option('debug', { hidden: true, type: 'boolean' })
    .option('limit', {
      default: '10',
      description: 'The limit.',
      short: 'l',
      type: 'string',
      validate: z.string().regex(/^[0-9]+$/u),
    })
    .option('tag', { multiple: true, type: 'string' })
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
    plugins: [help(), version(), format(), manifest()],
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
  return new Application('app', { plugins: [manifest()] })
    .option('odd', { default: value, type: 'string', validate: z.any() })
    .action(dispatch);
}

/** A hand-written schema whose converter publishes a bound JSON cannot carry. */
const unboundedSchema = {
  '~standard': {
    jsonSchema: { input: () => ({ minimum: Number.NaN, type: 'number' }), output: () => ({}) },
    validate: (value) => ({ value }),
    vendor: 'fixture',
    version: 1,
  },
};

/** An application whose one option publishes that schema. */
const unbounded = () =>
  new Application('app', { plugins: [manifest()] })
    .option('odd', { type: 'string', validate: unboundedSchema })
    .action(dispatch);

/** An application whose non-plain default sits on a global, a child Command's option, or an argument. */
function placed(where, value) {
  const odd = { default: value, type: 'string', validate: z.any() };
  const app = new Application('app', { plugins: [manifest()] });
  if (where === 'global') {
    return app.globalOption('odd', odd).action(dispatch);
  }
  if (where === 'argument') {
    return app.argument('odd', { default: value, validate: z.any() }).action(dispatch);
  }
  return app.command(new Command('child').option('odd', odd).action(dispatch)).action(dispatch);
}

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
  schema: unbounded,
};

const [scenario, ...argv] = process.argv.slice(2);
// `COLOR=always` forces color and modifiers on, so a test compares the bytes under both settings.
const forced = process.env.COLOR === 'always';
await scenarios[scenario]().run({
  host: { argv },
  ...(forced ? { rendering: { color: 'always', modifiers: 'always' } } : {}),
});
