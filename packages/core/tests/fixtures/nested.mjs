import { Application, Command } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    const clear = new Command('clear')
      .option('force', { short: 'F', type: 'boolean' })
      .action(report('clear'));

    // Aliases route like the canonical name, and a group carries them like any other Command.
    const list = new Command('list').alias('ls', 'l').action(report('list'));

    // A Command with children and no action is a group; routing requires one of its children.
    const cache = new Command('cache').alias('c').command(clear).command(list);

    // One namespace belongs to one parent, so "ls" is free here while "cache" already spends it.
    const put = new Command('put').alias('ls').action(report('put'));

    // A Command with children and an action keeps its options and runs its action when it is selected.
    const store = new Command('store')
      .option('pretty', { short: 'p', type: 'boolean' })
      .command(put)
      .action(report('store'));

    const app = new Application('nested')
      .globalOption('file', { short: 'f', type: 'string' })
      .command(cache)
      .command(store)
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
