import { Application } from '@loomcli/core';

import { ruleText } from './rule-text.mjs';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const scenario = words[0];

    const rows = [
      { count: 6, source: 'one.txt' },
      { count: 2, source: 'two words.txt' },
    ];

    // The view owns every byte, so these two differ only in the newlines they return.
    const table = { render: (data) => data.map((row) => `${row.count}  ${row.source}\n`).join('') };
    const bare = { render: (data) => data.map((row) => row.source).join(' ') };
    const breaks = {
      render: () => {
        throw new Error('Cannot render the table.');
      },
    };

    const app = new Application('render').action(async ({ out }) => {
      switch (scenario) {
        case 'bytes': {
          await out.render(rows, table);
          break;
        }
        case 'exact': {
          await out.render(rows, bare);
          break;
        }
        case 'order': {
          out.print('before');
          out.render(rows, table);
          out.print('after');
          break;
        }
        case 'unawaited': {
          out.render(rows, breaks);
          out.print('after');
          break;
        }
        case 'caught': {
          try {
            await out.render(rows, breaks);
            out.print('unreachable');
          } catch (error) {
            out.print(`caught:${ruleText(error)}`);
          }
          out.print('after');
          break;
        }
        case 'late': {
          // The helper outlives the action, so its render failure lands while the writes still settle.
          const helper = async () => {
            await Promise.resolve();
            await Promise.resolve();
            out.render(rows, breaks);
            await out.print('late');
          };
          void helper();
          break;
        }
        case 'action-failure': {
          out.render(rows, breaks);
          throw new Error('The action failed.');
        }
        default: {
          throw new Error(`Unknown scenario: ${scenario}`);
        }
      }
    });

    const code = await app.run({
      process: createProcess({ argv: [], release: { build: 'distributed' } }),
    });
    writeStdout(`resolved:${code}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
