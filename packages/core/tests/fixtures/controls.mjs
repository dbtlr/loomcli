import { escapeControlCharacters } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { stdout: writeStdout } = fixture;
  try {
    // Each argument arrives as JSON, so a test can pass any code point through the process boundary.
    const texts = JSON.parse(words[0]);
    writeStdout(JSON.stringify(texts.map((text) => escapeControlCharacters(text))));
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
