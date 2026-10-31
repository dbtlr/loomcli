import { Application, reportedSpelling } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { stdout: writeStdout } = fixture;
  try {
    /**
     * Options of every shape a reported spelling distinguishes: a long form with a short alias, each
     * Boolean polarity, a short-only option of each kind, an option that keeps aliases, and a count.
     */
    const app = new Application('spelled')
      .globalOption('file', { short: 'f', type: 'string' })
      .option('quiet', { polarity: 'negative', type: 'boolean' })
      .option('color', { polarity: 'both', type: 'boolean' })
      .option('exact', { short: 'x', shortOnly: true, type: 'string' })
      .option('keep', { polarity: 'negative', short: 'k', shortOnly: true, type: 'boolean' })
      .option('min-bytes', { aliases: ['minimum', 'min'], type: 'string' })
      .option('verbose', { short: 'v', type: 'count' })
      .action(() => {});

    const { globals, root } = app.inspect();
    const reported = Object.fromEntries(
      [...globals, ...root.options].map((option) => [option.name, reportedSpelling(option)]),
    );
    writeStdout(`${JSON.stringify(reported)}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
