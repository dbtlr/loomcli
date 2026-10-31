import { Application } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    const app = new Application('options')
      .argument('files', { required: true, variadic: true })
      .option('metric', { short: 'm', type: 'string' })
      .option('depth', { short: 'd', type: 'string' })
      .option('pattern', { type: 'string' })
      .option('total', { short: 't', type: 'boolean' })
      .action(({ args, options, passthrough, host, out }) => {
        out.print(JSON.stringify({ args, argv: host.argv, options, passthrough }));
      });

    await app.run({ process: createProcess({ argv: words.slice(1) }) });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
