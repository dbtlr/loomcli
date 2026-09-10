import { Application, Command, GlobalOptions } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';
import { version } from '@loomcli/plugins/version';
import { z } from 'zod';

import { recordLoads } from '../../../../scripts/record-loads.mjs';

const dispatch = ({ out }) => out.print('dispatched');

/** Every scenario installs the pack in the order the examples do, so help wins a tie. */
const plugins = [help(), version()];

/** One application whose declared version is the scenario, so the printed line is the only rule. */
function versioned(declared) {
  const child = new Command('get', { description: 'Read one value at a path.' }).action(dispatch);
  return new Application('app', {
    description: 'A fixture application.',
    plugins,
    ...declared,
  })
    .command(child)
    .action(dispatch);
}

/** A group, a child with an action and children of its own, and a root that has both forms. */
function nested() {
  const clear = new Command('clear', { description: 'Empty the cache.' }).action(dispatch);
  const cache = new Command('cache', { description: 'Manage the cache.' }).command(clear);
  const now = new Command('now', { description: 'Copy it at once.' }).action(dispatch);
  const sync = new Command('sync', { description: 'Copy the store to a remote.' })
    .command(now)
    .action(dispatch);
  return new Application('store', {
    description: 'Keep a local store.',
    plugins,
    version: '1.2.0',
  })
    .command(cache)
    .command(sync)
    .action(dispatch);
}

/** One option row for each left cell the page can print, on a root that folds in the globals. */
function cells() {
  return (
    new Application('app', {
      description: 'Show one option row for each spelling.',
      plugins,
      version: '1.2.0',
    })
      .option('file', {
        description: 'The document to read.',
        extensions: [helpInput({ placeholder: 'path' })],
        short: 'f',
        type: 'string',
      })
      .option('explain', { description: 'Explain the selected command and exit.', type: 'boolean' })
      .option('metric', {
        default: 'bytes',
        description: 'What each row counts.',
        short: 'm',
        shortOnly: true,
        type: 'string',
      })
      .option('total', { description: 'Add a total row.', short: 't', type: 'boolean' })
      .option('quiet', { description: 'Print nothing.', polarity: 'negative', type: 'boolean' })
      .option('cache', { description: 'Use the cache.', polarity: 'both', type: 'boolean' })
      // A placeholder on a Boolean option is accepted and never shown.
      .option('verbose', {
        description: 'Say more.',
        extensions: [helpInput({ placeholder: 'level' })],
        type: 'boolean',
      })
      .action(dispatch)
  );
}

/** One row for each fact the right-cell rule can carry, and two rows that carry none. */
function facts() {
  return (
    new Application('app', {
      description: 'Show one right cell for each fact.',
      plugins,
      version: '1.2.0',
    })
      .argument('path', { description: 'Dot path to read.', required: true })
      .argument('depth', { default: '1', description: 'How deep to walk.' })
      .option('field', {
        description: 'A field to keep.',
        multiple: true,
        required: true,
        short: 'F',
        type: 'string',
      })
      .option('mode', { default: 'plain', description: 'How to print.', type: 'string' })
      .option('tags', {
        default: ['one', 'two'],
        description: 'The tags to keep.',
        multiple: true,
        type: 'string',
      })
      // A JSON value the page renders with `JSON.stringify`. A raw default needs a schema.
      .option('limit', {
        default: 3,
        description: 'How many rows.',
        type: 'string',
        validate: z.coerce.number(),
      })
      .option('label', { default: 'a\nb', description: 'The label.', type: 'string' })
      // A bigint has no JSON rendering, and JSON renders a non-finite number as `null`.
      // Each of the three therefore prints as `String` renders it.
      .option('count', {
        default: 10n,
        description: 'How many items.',
        type: 'string',
        validate: z.bigint(),
      })
      .option('nan', {
        default: Number.NaN,
        description: 'The unset ratio.',
        type: 'string',
        validate: z.any(),
      })
      .option('inf', {
        default: Number.POSITIVE_INFINITY,
        description: 'The upper bound.',
        type: 'string',
        validate: z.any(),
      })
      // An explicit `undefined` default reads apart from no default at all and prints no fact.
      .option('note', {
        default: undefined,
        description: 'A note.',
        type: 'string',
        validate: z.string().optional(),
      })
      .option('source', { required: true, type: 'string' })
      .option('plain', { type: 'boolean' })
      .action(dispatch)
  );
}

/** Arguments, variadics, and required options from two scopes, on a root that has both forms. */
function usage() {
  const globals = new GlobalOptions()
    .option('key', { description: 'The key to use.', required: true, type: 'string' })
    .option('file', { description: 'The document to read.', short: 'f', type: 'string' });
  const run = new Command('run', { description: 'Run one job.', globals })
    .argument('source', { description: 'Where to read.', required: true })
    .argument('target', { description: 'Where to write.' })
    .option('out', {
      description: 'The output path.',
      required: true,
      short: 'o',
      type: 'string',
    })
    .option('tag', {
      description: 'A tag to apply.',
      multiple: true,
      required: true,
      type: 'string',
    })
    .option('mode', { description: 'How to run.', type: 'string' })
    .action(dispatch);
  const pack = new Command('pack', { description: 'Pack the files.', globals })
    .argument('files', { description: 'The files to pack.', required: true, variadic: true })
    .action(dispatch);
  return new Application('app', {
    description: 'Do the work.',
    globals,
    plugins,
    version: '1.2.0',
  })
    .command(run)
    .command(pack)
    .action(dispatch);
}

/** A root with no description, prose across three line terminators, and two examples. */
function prose() {
  return new Application('app', {
    extensions: [
      helpCommand({
        details: 'first line\r\nsecond line\u0085third line',
        examples: [{ command: 'run one', note: 'The first job.' }, { command: 'run two' }],
      }),
    ],
    plugins,
    version: '1.2.0',
  }).action(dispatch);
}

/** A child of each listing shape: plain, deprecated, hidden, both, and an all-hidden group. */
function children() {
  const get = new Command('get', { description: 'Read one value at a path.' }).action(dispatch);
  const fetch = new Command('fetch', {
    deprecated: 'Use get instead.',
    description: 'Read one value at a path.',
  }).action(dispatch);
  const debug = new Command('debug', { description: 'Dump the document.', hidden: true })
    .option('depth', { description: 'How deep to walk.', type: 'string' })
    .option('trace', { description: 'Trace the run.', hidden: true, type: 'boolean' })
    .action(dispatch);
  const gone = new Command('gone', {
    deprecated: 'Use get instead.',
    description: 'Read the old way.',
    hidden: true,
  }).action(dispatch);
  const clear = new Command('clear', { description: 'Empty the cache.', hidden: true }).action(
    dispatch,
  );
  const cache = new Command('cache', { description: 'Manage the cache.' }).command(clear);
  return new Application('app', { description: 'Do the work.', plugins, version: '1.2.0' })
    .command(get)
    .command(fetch)
    .command(debug)
    .command(gone)
    .command(cache)
    .action(dispatch);
}

/** A root with an action whose every child is hidden, so no listing of children survives. */
function unlisted() {
  const debug = new Command('debug', { description: 'Dump the document.', hidden: true }).action(
    dispatch,
  );
  return new Application('app', { description: 'Do the work.', plugins, version: '1.2.0' })
    .command(debug)
    .action(dispatch);
}

/** A hidden option and a deprecated option in each scope a page prints as its own section. */
function scoped() {
  const globals = new GlobalOptions()
    .option('key', { description: 'The key to use.', required: true, type: 'string' })
    .option('token', {
      description: 'The token to use.',
      hidden: true,
      required: true,
      type: 'string',
    });
  const run = new Command('run', { description: 'Run one job.', globals }).action(dispatch);
  return new Application('app', {
    description: 'Do the work.',
    globals,
    plugins,
    version: '1.2.0',
  })
    .option('mode', {
      default: 'plain',
      deprecated: 'Use --style instead.',
      description: 'How to print.',
      type: 'string',
    })
    .option('trace', { description: 'Trace the run.', hidden: true, type: 'boolean' })
    .command(run)
    .action(dispatch);
}

/** A hidden option of each scope on a root that folds the globals into its own OPTIONS. */
function folded() {
  const globals = new GlobalOptions()
    .option('key', { description: 'The key to use.', type: 'string' })
    .option('token', { description: 'The token to use.', hidden: true, type: 'string' });
  return new Application('app', {
    description: 'Do the work.',
    globals,
    plugins,
    version: '1.2.0',
  })
    .option('mode', { description: 'How to print.', type: 'string' })
    .option('trace', { description: 'Trace the run.', hidden: true, type: 'boolean' })
    .action(dispatch);
}

const scenarios = {
  cells,
  children,
  facts,
  folded,
  nested,
  prose,
  scoped,
  unlisted,
  usage,
  version: () => versioned({ version: '1.2.0' }),
  'version-omitted': () => versioned({}),
  'version-prefixed': () => versioned({ version: 'v0.2.0' }),
  'version-upper': () => versioned({ version: 'V0.2.0' }),
};

await recordLoads();

const [name, ...argv] = process.argv.slice(2);

process.exitCode = await scenarios[name]().run({ host: { argv } });
