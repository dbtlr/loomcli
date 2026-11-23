import { Application, Command } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const leaf = (name) => new Command(name).action(dispatch);

    // One value sits in two Applications, and two distinct values share a name under two parents.
    // Every graph here is a tree, so every build must succeed, however often it runs.
    const shared = leaf('clear');
    const first = new Application('tree-first')
      .globalOption('file', { short: 'f', type: 'string' })
      .command(new Command('cache').command(shared))
      .action(dispatch);
    const second = new Application('tree-second')
      .globalOption('file', { short: 'f', type: 'string' })
      .command(new Command('cache').command(leaf('clear')))
      .command(new Command('store').command(leaf('clear')))
      .command(new Command('extra').command(shared))
      .action(dispatch);

    const lines = [];
    const errors = [];

    const recorded = [];
    function captured(argv) {
      const mock = createProcess({ argv, record: false });
      recorded.push(mock);
      return mock;
    }
    const codes = [];
    first.inspect();
    first.inspect();
    codes.push(
      await first.run({
        process: captured(['cache', 'clear']),
      }),
    );
    codes.push(
      await first.run({
        process: captured(['cache', 'clear']),
      }),
    );
    codes.push(
      await second.run({
        process: captured(['cache', 'clear']),
      }),
    );
    codes.push(
      await second.run({
        process: captured(['store', 'clear']),
      }),
    );
    codes.push(
      await second.run({
        process: captured(['extra', 'clear']),
      }),
    );
    second.inspect();
    for (const mock of recorded) {
      lines.push(...mock.stdout.text.split('\n').filter(Boolean));
      errors.push(...mock.stderr.text.split('\n').filter(Boolean));
    }
    writeStdout(`${JSON.stringify({ codes, errors, lines })}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const dispatch = ({ out }) => out.print('dispatched');

export { runFixture as run };
