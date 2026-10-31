import { interaction } from '@loomcli/plugins/interaction';

import { Application } from '../../dist/index.js';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const scenario = fixtureWords[0];
    try {
      if (scenario === 'twice') {
        new Application('setup')
          .globalOption('input', { interaction: true, type: 'boolean' })
          .globalOption('other', { interaction: true, type: 'boolean' });
      } else {
        const app = new Application('setup', {
          description: 'Configure the service.',
          plugins: [interaction({ env: 'SETUP_INPUT' })],
        })
          .option('port', {
            description: 'Service port.',
            required: 'non-interactive',
            type: 'string',
          })
          .action(async (context) => {
            if (scenario === 'cancel') {
              context.cancel();
              throw context.signal.reason;
            }
            await context.out.print(JSON.stringify({ interactive: context.interactive }));
          });
        if (scenario === 'invoke') {
          const outcome = await app.invoke(
            [],
            { options: { port: '8080' } },
            { process: createProcess() },
          );
          writeStdout(outcome.output);
        } else {
          fixture.exitCode = await app.run({
            process: createProcess({
              argv:
                { disabled: ['--no-input', '--port', '8080'], env: ['--port', '8080'] }[scenario] ??
                [],
              env: scenario === 'env' ? { SETUP_INPUT: 'false' } : {},
              terminal: {
                stderr: { columns: 80, isTTY: true, rows: 24 },
                stdin: { isTTY: true },
                stdout: { columns: undefined, isTTY: false, rows: undefined },
              },
            }),
          });
        }
      }
    } catch (error) {
      writeStdout(JSON.stringify({ message: error.message, name: error.name }));
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
