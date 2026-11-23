import { Application, Command } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    const get = new Command('get').argument('path', { required: true }).action(report('get'));
    const base = new Application('copies').option('quiet', { short: 'q', type: 'boolean' });

    // Each call returns a new declaration, so these three values share nothing but their receiver.
    const root = base.action(report('root'));
    const forked = base.option('verbose', { type: 'boolean' }).action(report('root'));
    const composed = base.command(get).action(report('root'));

    // `alias()` returns a new declaration too, so the receiver still answers to its name alone.
    const keys = new Command('keys');
    const aliased = new Application('aliased')
      .command(keys.alias('ls').action(report('keys')))
      .action(report('root'));
    const plain = new Application('plain')
      .command(keys.action(report('keys')))
      .action(report('root'));

    const shared = new Application('empty')
      .command(new Command('leaf').action(report('leaf')))
      .action(report('root'));

    const declarations = { aliased, composed, forked, plain, root, shared };
    await declarations[words[0]].run({
      process: createProcess({ argv: words.slice(1) }),
    });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const report =
  (command) =>
  ({ args, options, out }) =>
    out.print(JSON.stringify({ args, command, options }));

export { runFixture as run };
