import { Application, Command, locate, plugin } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const [scenario, ...argv] = fixtureWords;

    /** A whole number, so a rejected value shows which spelling validation names. */
    const digits = {
      '~standard': {
        validate: (value) =>
          /^[0-9]+$/u.test(value) ? { value } : { issues: [{ message: 'Use a whole number.' }] },
        vendor: 'probe',
        version: 1,
      },
    };

    /** Every action prints the path it ran on and the values it received. */

    /** A plugin whose global option keeps an old spelling as an alias. */
    const trace = plugin('@fixture/trace', {
      options: { trace: { aliases: ['debug'], type: 'boolean' } },
    });

    /**
     * Options of every kind that each keep another name: a string option bound to a variable, a
     * Boolean option of each polarity, a multiple option, a global option, and a plugin's option.
     */
    function sizes() {
      return new Application('sizes', { plugins: [trace] })
        .globalOption('file', { aliases: ['input'], type: 'string' })
        .option('min-bytes', {
          aliases: ['minimum', 'min'],
          env: 'SIZES_MIN_BYTES',
          type: 'string',
          validate: digits,
        })
        .option('color', { aliases: ['colour'], polarity: 'both', type: 'boolean' })
        .option('quiet', { aliases: ['silent'], polarity: 'negative', type: 'boolean' })
        .option('field', { aliases: ['column'], multiple: true, type: 'string' })
        .command(new Command('list').action(report(['list'])))
        .action(report([]));
    }

    /** The spellings one option node publishes, beside its declared aliases. */

    const scenarios = {
      inspect: () => {
        const { globals, root } = sizes().inspect();
        writeStdout(
          `${JSON.stringify({ globals: globals.map(spellings), options: root.options.map(spellings) })}\n`,
        );
      },
      locate: () => {
        const position = locate(sizes().inspect(), argv);
        writeStdout(
          `${JSON.stringify({ kind: position.kind, lead: position.lead, option: position.option?.name, prefix: position.prefix })}\n`,
        );
      },
      repeated: async () => {
        // Each repeat names the option, an alias before it, or a spelling the option already accepts.
        const app = new Application('sizes')
          .option('min-bytes', { aliases: ['minimum', 'minimum', 'min-bytes'], type: 'string' })
          .option('color', { aliases: ['no-color', 'colour'], polarity: 'both', type: 'boolean' })
          .action(report([]));
        const [bytes, color] = app.inspect().root.options;
        writeStdout(`${JSON.stringify([bytes?.aliases, color?.aliases])}\n`);
        await app.run({ process: createProcess({ argv }) });
      },
      run: async () => {
        fixture.exitCode = await sizes().run({ process: createProcess({ argv }) });
      },
    };

    await scenarios[scenario]();
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

function report(command) {
  return ({ options, out }) => out.print(JSON.stringify({ command, options }));
}
const spellings = ({ aliases, long, name, negative, short }) => ({
  aliases,
  long,
  name,
  negative,
  short,
});

export { runFixture as run };
