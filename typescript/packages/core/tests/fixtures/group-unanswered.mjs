import { z } from 'zod';

import { Application, extension, plugin } from '../../dist/index.js';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess } = fixture;
  try {
    const kind = fixtureWords[0];
    const binding = extension('@fixture/group-source/key', {
      schema: z.string(),
      target: 'option',
    });
    const source = plugin('@fixture/group-source', {
      extensions: [binding],
      options: {
        config: {
          description: 'Configuration.',
          type: 'string',
          validate: z.literal('good', { error: 'Use good.' }),
        },
      },
      source: {
        binding,
        load: async () => ({
          default: async () => {
            throw new Error('Must not load.');
          },
        }),
      },
    });
    const app = new Application('groups', { description: 'Groups probe.', plugins: [source] })
      .option('first', {
        description: 'Unknown choice.',
        extensions: [binding('first')],
        type: 'string',
      })
      .option('second', { description: 'Known choice.', type: 'string' })
      .option('third', { description: 'Other choice.', type: 'string' });
    let grouped = app.oneRequired('first', 'third');
    if (kind === 'together') {
      grouped = app.requiredTogether('first', 'second', 'third');
    }
    if (kind === 'exclusive') {
      grouped = app.exclusive('second', 'third');
    }
    const argv = ['--config', 'bad', '--second', 'given'];
    if (kind === 'exclusive') {
      argv.push('--third', 'given');
    }
    fixture.exitCode = await grouped
      .action(() => {})
      .run({ process: createProcess({ argv, env: {} }) });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
