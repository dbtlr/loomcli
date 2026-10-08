import { Application, plugin } from '@loomcli/core';

import { configKey } from '../sources/extension.mjs';

/**
 * A plugin that reports the spellings its middleware reads, and whether the record is frozen.
 * `level` is bound to a variable, `from` to the configuration source, and `mode` has a default.
 */
const spelled = () =>
  plugin('@fixture/spelled', {
    middleware: {
      activate: 'always',
      load: async () => ({
        default: async ({ next, options, out, spellings }) => {
          await out.print(`options:${JSON.stringify(options)}`);
          await out.print(`spellings:${JSON.stringify(spellings)}`);
          await out.print(`frozen:${Object.isFrozen(spellings)}`);
          await next();
        },
      }),
    },
    options: {
      // A name an object literal would read as its prototype, which must stay an own entry.
      ['__proto__']: { type: 'boolean' },
      flag: { polarity: 'both', short: 'f', type: 'boolean' },
      from: { extensions: [configKey('from')], type: 'string' },
      level: { env: 'FIXTURE_LEVEL', type: 'string' },
      mode: { default: 'plain', type: 'string' },
      name: { multiple: true, short: 'n', type: 'string' },
      quiet: { short: 'q', type: 'boolean' },
    },
  });

/** Another plugin's option, which the spelled plugin never reads. */
const neighbor = () => plugin('@fixture/neighbor', { options: { loud: { type: 'boolean' } } });

/** The configuration source, which answers `from` out of `FIXTURE_SETTINGS`. */
const config = () =>
  plugin('@fixture/config', {
    extensions: [configKey],
    source: { binding: configKey, load: () => import('../sources/source.mjs') },
  });

const code = await new Application('app', { plugins: [config(), spelled(), neighbor()] })
  .globalOption('file', { short: 'F', type: 'string' })
  .option('local', { type: 'boolean' })
  .action(({ out }) => out.print('root'))
  .run({ host: { argv: process.argv.slice(2), release: { build: 'distributed' } } });
process.stdout.write(`resolved:${code}\n`);
