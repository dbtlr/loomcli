import { Application } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const code = await new Application('reporting')
      .action(() => {
        throw new Error('Action failed.');
      })
      .run({ process: createProcess({ argv: [], stderr: {} }) });
    writeStdout(`resolved:${code}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
