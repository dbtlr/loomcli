import { isRuleIdentity } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { stdout: writeStdout } = fixture;
  try {
    // Each argument is JSON, so a test can pass a value that is not a string.
    const answers = words.map((argument) => isRuleIdentity(JSON.parse(argument)));
    writeStdout(`${JSON.stringify(answers)}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
