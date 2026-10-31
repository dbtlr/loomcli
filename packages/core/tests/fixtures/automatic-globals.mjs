import { Application, Command } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    const read = new Command('read')
      .argument('path', { required: true })
      .option('raw', { type: 'boolean' })
      .action(({ args, options, out }) => out.print(JSON.stringify({ args, options })));

    const app = new Application('example')
      .globalOption('quiet', { type: 'boolean' })
      .globalOption('limit', {
        type: 'string',
        validate: {
          '~standard': {
            validate: (value) => ({ value: Number(value) }),
            vendor: 'fixture',
            version: 1,
          },
        },
      })
      .command(read);

    await app.run({ process: createProcess({ argv: words }) });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
