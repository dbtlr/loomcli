import { Application, glyph, style } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess } = fixture;
  try {
    let plain = '';
    let cells = 0;
    const app = new Application('view', {
      description: 'Resolve view text.',
      rendering: { color: 'always', modifiers: 'always', terminalControls: 'preserve' },
    }).action(async ({ out }) => {
      await out.draw(undefined, {
        render: (_data, context) => {
          plain = context.plain(`${style.bold('Name')} ${glyph.pointer}\u001b[2J`);
          cells = context.width(style.escape(plain));
          return '';
        },
      });
      await out.print(JSON.stringify({ cells, plain }));
    });
    fixture.exitCode = await app.run({
      process: createProcess({ argv: [], env: { TERM: 'linux' }, platform: 'linux' }),
    });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
