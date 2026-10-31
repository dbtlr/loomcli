import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { interaction } from '@loomcli/plugins/interaction';
import { manifest } from '@loomcli/plugins/manifest';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const app = new Application('setup', {
      description: 'Configure the service.',
      plugins: [help(), interaction(), manifest()],
    })
      .option('port', { description: 'Service port.', required: 'non-interactive', type: 'string' })
      .action(() => {});
    if (fixtureWords[0] === 'inspect') {
      writeStdout(JSON.stringify(app.inspect()));
    } else {
      fixture.exitCode = await app.run({ process: createProcess({ argv: [fixtureWords[0]] }) });
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
