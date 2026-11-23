import { Application, Command } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    /** Every supplied value fails, so the diagnostic lines report the validation order alone. */

    const order = new Command('order')
      .option('local', { type: 'string', validate: reject('local') })
      .argument('path', { required: true, validate: reject('path') })
      .action(({ out }) => out.print('order'));

    const pair = new Command('pair')
      .argument('one', { required: true })
      .argument('two', { required: true })
      .action(({ args, out }) => out.print(JSON.stringify(args)));

    await new Application('order')
      .globalOption('alpha', { type: 'string', validate: reject('alpha') })
      .globalOption('beta', { type: 'string', validate: reject('beta') })
      .command(order)
      .command(pair)
      .action(({ out }) => out.print('root'))
      .run({ process: createProcess({ argv: words }) });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const reject = (label) => ({
  '~standard': {
    validate: () => ({ issues: [{ message: `${label} rejected.` }] }),
    vendor: 'fixture',
    version: 1,
  },
});

export { runFixture as run };
