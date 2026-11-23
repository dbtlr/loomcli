import { Application, plugin } from '@loomcli/core';

import { scenario as fixtureScenario } from '../scenario.mjs';
import { configKey } from '../sources/extension.mjs';
import { sourceModule } from '../sources/source.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, env: fixtureEnv, stdout: writeStdout } = fixture;
  try {
    const config = () =>
      plugin('@fixture/config', {
        extensions: [configKey],
        source: {
          binding: configKey,
          load: () => sourceModule({ abort: () => {}, env: fixtureEnv, stdout: writeStdout }),
        },
      });
    /**
     * A plugin that reports the spellings its middleware reads, and whether the record is frozen.
     * `level` is bound to a variable, `from` to the configuration source, and `mode` has a default.
     */

    /** Another plugin's option, which the spelled plugin never reads. */

    /** The configuration source, which answers `from` out of `FIXTURE_SETTINGS`. */

    const code = await new Application('app', { plugins: [config(), spelled(), neighbor()] })
      .globalOption('file', { short: 'F', type: 'string' })
      .option('local', { type: 'boolean' })
      .action(({ out }) => out.print('root'))
      .run({ process: createProcess({ argv: fixtureWords }) });
    writeStdout(`resolved:${code}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

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
const neighbor = () => plugin('@fixture/neighbor', { options: { loud: { type: 'boolean' } } });

export { runFixture as run };
