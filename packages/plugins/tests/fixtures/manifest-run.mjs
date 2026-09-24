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
  const weird = new Command('weird', { description: 'A \u009b control.' }).action(dispatch);
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
    .action(dispatch);
}

/** An application whose one option declares a default that JSON cannot carry. */
function defaulted(value) {
  return new Application('app', { plugins: [manifest()] })
    .option('odd', { default: value, type: 'string', validate: z.any() })
    .action(dispatch);
}

const scenarios = {
  app: application,
  bigint: () => defaulted(10n),
  function: () => defaulted(() => 'ten'),
  nan: () => defaulted(Number.NaN),
};

const [scenario, ...argv] = process.argv.slice(2);
await scenarios[scenario]().run({ host: { argv } });
