import { DeclarationError, Application } from '@loomcli/core';

import { ruleText } from './rule-text.mjs';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout } = fixture;

  function declare(build) {
    try {
      return build();
    } catch (error) {
      if (!(error instanceof DeclarationError)) {
        throw error;
      }
      writeStdout(`thrown:${error.exitCode}: ${ruleText(error)}\n`);
      throw fixture.stopped;
    }
  }
  try {
    const scenario = words[0];

    /** The one faulty option declaration each scenario makes, which throws from its own call. */
    function build() {
      let app = new Application('declarations');
      switch (scenario) {
        case 'duplicate-key': {
          app = app.option('total', { type: 'string' }).option('total', { type: 'boolean' });
          break;
        }
        case 'duplicate-short': {
          app = app
            .option('total', { short: 't', type: 'boolean' })
            .option('trace', { short: 't', type: 'boolean' });
          break;
        }
        case 'negative-collision': {
          app = app
            .option('total', { polarity: 'both', type: 'boolean' })
            .option('no-total', { type: 'string' });
          break;
        }
        case 'invalid-name': {
          app = app.option('bad=name', { type: 'string' });
          break;
        }
      }
      return app.action(({ out }) => out.print('dispatched'));
    }

    const app = declare(build);
    writeStdout('assembled\n');
    const code = await app.run({ process: createProcess({ argv: ['--unknown'] }) });
    writeStdout(`resolved:${code}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
