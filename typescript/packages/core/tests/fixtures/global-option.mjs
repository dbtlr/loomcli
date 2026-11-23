import { DeclarationError, Application } from '@loomcli/core';

import { ruleText } from './rule-text.mjs';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
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
    const base = new Application('example').globalOption('quiet', { type: 'boolean' });

    const scenario = fixtureWords[0];
    const scenarios = {
      derived: () => base.globalOption('limit', { default: '10', type: 'string' }).action(action),
      'local-first': () =>
        new Application('example')
          .option('quiet', { type: 'boolean' })
          .globalOption('quiet', { type: 'boolean' })
          .action(action),
      original: () => base.action(action),
    };
    const app = declare(scenarios[scenario]);
    fixture.exitCode = await app.run({ process: createProcess({ argv: [] }) });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const action = ({ options, out }) => out.print(JSON.stringify(options));

export { runFixture as run };
