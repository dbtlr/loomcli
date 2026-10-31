import { Application } from '../../dist/index.js';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess } = fixture;
  try {
    const app = new Application('setup', { description: 'Configure the service.' })
      .option('port', {
        description: 'Service port.',
        required: 'non-interactive',
        type: 'string',
        validate: {
          '~standard': {
            validate: (value) => ({ value: Number(value) }),
            vendor: 'fixture',
            version: 1,
          },
        },
      })
      .action(async (context) => {
        await context.out.print(
          JSON.stringify({
            interactive: context.interactive,
            port: context.options.port,
            raw: context.supplied.options.port,
          }),
        );
      });

    fixture.exitCode = await app.run({ process: createProcess() });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
