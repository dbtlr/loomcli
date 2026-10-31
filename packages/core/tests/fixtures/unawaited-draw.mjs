import { Application } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const app = new Application('draw').action(({ out }) => {
      out.draw('value', {
        render: () => {
          throw new Error('view failed');
        },
      });
    });
    const code = await app.run({
      process: createProcess({ argv: [], release: { build: 'distributed' } }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    writeStdout(`CODE:${code}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
