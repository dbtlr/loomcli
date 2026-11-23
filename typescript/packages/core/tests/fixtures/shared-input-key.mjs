import { Application } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess } = fixture;
  try {
    await new Application('shared-input-key')
      .argument('files', { required: true, variadic: true })
      .option('files', { type: 'boolean' })
      .action(({ args, options, out }) => out.print(JSON.stringify({ args, options })))
      .run({ process: createProcess() });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
