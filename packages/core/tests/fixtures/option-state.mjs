import { Application } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess } = fixture;
  try {
    const config = { polarity: 'negative', short: 'n', type: 'boolean' };
    const base = new Application('state')
      .option('enabled', config)
      .option('__proto__', { type: 'string' })
      .option('dryRun', { type: 'boolean' });
    config.polarity = 'positive';
    config.short = 'x';

    const left = base.option('left', { short: 'l', type: 'boolean' });
    const right = base.option('right', { short: 'l', type: 'boolean' });

    const first = left.action(report);
    const second = right.action(report);
    await first.run({
      process: createProcess({
        argv: ['-nl', '--__proto__=safe', '--dryRun', '--', '--', '', 'two words'],
      }),
    });
    await first.run({ process: createProcess({ argv: [] }) });
    await second.run({ process: createProcess({ argv: ['-l'] }) });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

function report({ options, passthrough, out }) {
  out.print(JSON.stringify({ options, passthrough }));
  options.enabled = false;
  passthrough.push('action mutation');
}

export { runFixture as run };
