import { Application, Command, plugin, validationContext } from '@loomcli/core';
import { z } from 'zod';

import { configKey } from './extension.mjs';

if (process.env.FIXTURE_TTY === '1') {
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
}

/** How the configuration plugin loads its source, chosen by the test. */
const loaders = {
  // The loader aborts the caller's signal, so the abort lands while the source loads.
  aborts: () => {
    process.stdout.write('loader:called\n');
    globalThis.fixtureAbort();
    return import('./source.mjs');
  },
  module: () => import('./source.mjs'),
  'no-default': () => import('./modules.mjs'),
  recording: () => {
    process.stdout.write('loader:called\n');
    return import('./source.mjs');
  },
  throws: () => {
    throw new Error('the loader threw before it could import');
  },
};

/** The configuration plugin: one own option, and the source that answers for `configKey`. */
const config = () =>
  plugin('@fixture/config', {
    extensions: [configKey],
    options: {
      config: { default: 'fixture.json', env: 'FIXTURE_CONFIG_FILE', type: 'string' },
    },
    source: { binding: configKey, load: loaders[process.env.FIXTURE_LOADER ?? 'module'] },
  });

/** A logging plugin whose options a variable and the configuration source both fill. */
const log = () =>
  plugin('@fixture/log', {
    middleware: {
      activate: ['verbose', 'level'],
      load: async () => ({
        default: async ({ next, options, out }) => {
          await out.print(`log:${JSON.stringify(options)}`);
          await next();
        },
      }),
    },
    options: {
      level: { env: 'FIXTURE_LEVEL', extensions: [configKey('log.level')], type: 'string' },
      verbose: { env: 'FIXTURE_VERBOSE', type: 'boolean' },
    },
  });

/** A help plugin that takes over, so a held fault is never raised under it. */
const help = () =>
  plugin('@fixture/help', {
    middleware: {
      activate: ['help'],
      load: async () => ({ default: ({ out }) => out.print('help') }),
    },
    options: { help: { short: 'h', type: 'boolean' } },
  });

const installed = {
  full: () => [config(), log(), help()],
  plain: () => [log(), help()],
};

const digits = z.string().regex(/^[0-9]+$/u, 'Supply a whole number.');

/** A schema that prints the value and the supplied record it received, then accepts it. */
const recording = {
  '~standard': {
    validate: (value, options) => {
      const supplied = validationContext(options)?.supplied.options.file;
      process.stdout.write(`schema:file:${JSON.stringify({ supplied, value })}\n`);
      return { value: value ?? 'none' };
    },
    vendor: 'fixture',
    version: 1,
  },
};

const print =
  (label) =>
  ({ options, out }) =>
    out.print(`${label}:${JSON.stringify(options)}`);

function application() {
  const count = new Command('count')
    .option('max', { env: 'FIXTURE_MAX', required: true, type: 'string', validate: digits })
    .option('file', {
      env: 'FIXTURE_FILE',
      type: 'string',
      validate: recording,
      validateOmitted: true,
    })
    .option('total', { env: 'FIXTURE_TOTAL', extensions: [configKey('total')], type: 'boolean' })
    .option('quiet', { env: 'FIXTURE_QUIET', polarity: 'negative', type: 'boolean' })
    .option('color', { env: 'FIXTURE_COLOR', polarity: 'both', type: 'boolean' })
    .action(print('count'));
  const select = new Command('select')
    .option('fields', {
      extensions: [configKey('fields')],
      multiple: true,
      required: true,
      type: 'string',
      validate: z.array(z.string().min(1, 'Supply a field name.')),
    })
    .option('title', { extensions: [configKey('title')], type: 'string' })
    .action(print('select'));
  const paint = new Command('paint')
    .option('plain', { env: 'NO_COLOR', type: 'boolean' })
    .action(({ options, out, style }) => out.print(`paint:${options.plain}:${style.red('X')}`));
  const cache = new Command('cache').command(new Command('clear').action(print('clear')));
  // Variables named after Object.prototype members, which a plain-object env does not set.
  const inherited = new Command('inherited')
    .option('name', { env: 'constructor', type: 'string' })
    .option('flag', { env: 'toString', type: 'boolean' })
    .action(({ options, out }) => out.print(`inherited:${typeof options.name}:${options.flag}`));
  return new Application('app', { plugins: (installed[process.argv[2]] ?? (() => []))() })
    .globalOption('limit', {
      default: '10',
      env: 'FIXTURE_LIMIT',
      extensions: [configKey('limits.bytes')],
      type: 'string',
      validate: digits,
    })
    .command(count)
    .command(select)
    .command(paint)
    .command(cache)
    .command(inherited)
    .action(print('root'));
}

const mode = process.argv[3];
const argv = process.argv.slice(4);

if (mode === 'inspect') {
  process.stdout.write(`${JSON.stringify(application().inspect())}\n`);
} else if (mode === 'cancelled') {
  // The caller cancelled the run before it started.
  const controller = new AbortController();
  controller.abort();
  const code = await application().run({ host: { argv }, signal: controller.signal });
  process.stdout.write(`resolved:${code}\n`);
} else if (mode === 'cancel') {
  // The source aborts the caller's signal from inside its own call, so the abort lands in flight.
  const controller = new AbortController();
  globalThis.fixtureAbort = () => controller.abort();
  const code = await application().run({ host: { argv }, signal: controller.signal });
  process.stdout.write(`resolved:${code}\n`);
} else {
  const code = await application().run({ host: { argv } });
  process.stdout.write(`resolved:${code}\n`);
}
