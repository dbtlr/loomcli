import { Application, Command } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    const digits = {
      '~standard': {
        validate: (value) =>
          /^\d+$/.test(value)
            ? { value: Number(value) }
            : { issues: [{ message: 'Use decimal digits.' }] },
        vendor: 'fixture',
        version: 1,
      },
    };

    const get = new Command('get')
      .argument('path', { required: true })
      .option('raw', { short: 'r', type: 'boolean' })
      .action(report('get'));

    const keys = new Command('keys').action(report('keys'));

    const app = new Application('jsonkit')
      .globalOption('file', { short: 'f', type: 'string' })
      .globalOption('quiet', { short: 'q', type: 'boolean' })
      .globalOption('limit', { type: 'string', validate: digits })
      .option('pretty', { short: 'p', type: 'boolean' })
      .command(get)
      .command(keys)
      .action(report('root'));

    await app.run({ process: createProcess({ argv: words.slice(1) }) });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const report =
  (command) =>
  ({ args, options, passthrough, out }) =>
    out.print(JSON.stringify({ args, command, options, passthrough }));

export { runFixture as run };
