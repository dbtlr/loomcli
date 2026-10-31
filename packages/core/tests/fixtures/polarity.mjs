import { Application } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess } = fixture;
  try {
    await new Application('polarity')
      .option('total', { polarity: 'both', short: 't', type: 'boolean' })
      .option('color', { polarity: 'negative', short: 'c', type: 'boolean' })
      .option('silent', { polarity: 'negative', short: 's', shortOnly: true, type: 'boolean' })
      .option('metric', { short: 'm', shortOnly: true, type: 'string' })
      .action(({ options, passthrough, out }) =>
        out.print(JSON.stringify({ options, passthrough })),
      )
      .run({ process: createProcess() });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
