import { Application, Command } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    const get = new Command('get').argument('path', { required: true }).action(report('get'));

    const keys = new Command('keys').action(report('keys'));

    // The unnamed root is a group too: it attaches children and registers no action of its own.
    const app = new Application('nested-root')
      .globalOption('file', { short: 'f', type: 'string' })
      .command(get)
      .command(keys);

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
