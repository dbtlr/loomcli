import { Application, Command } from '../../dist/index.js';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess } = fixture;
  try {
    const [scenario, ...argv] = fixtureWords;
    const command = new Command('export', { description: 'Export a document.' })
      .option('json', { description: 'JSON output.', type: 'boolean' })
      .option('yaml', { description: 'YAML output.', type: 'boolean' });
    const grouped = command[scenario]('json', 'yaml').action(({ out }) => out.print('action'));
    fixture.exitCode = await new Application('groups', { description: 'Group probe.' })
      .command(grouped)
      .run({ process: createProcess({ argv: ['export', ...argv], env: {} }) });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
