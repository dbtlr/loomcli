import { Application, Command } from '@loomcli/core';
import { z } from 'zod';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    // One name and one alias, three value shapes. The globals put -f beside every local -F.

    const select = new Command('select')
      .option('field', { multiple: true, short: 'F', type: 'string' })
      .action(report('select'));

    const count = new Command('count')
      .option('field', { polarity: 'both', short: 'F', type: 'boolean' })
      .action(report('count'));

    const set = new Command('set')
      .option('field', {
        short: 'F',
        type: 'string',
        validate: z.string().transform((value) => value.toUpperCase()),
      })
      .action(report('set'));

    const cache = new Command('cache').command(set);

    const app = new Application('spellings')
      .globalOption('file', { short: 'f', type: 'string' })
      .command(select)
      .command(count)
      .command(cache)
      .action(report('root'));

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
