import { Application, nowrap, style } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    const input = JSON.parse(words[0]);
    const message = input.message
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        return 'nowrap' in part ? nowrap(part.nowrap) : style.red(part.red);
      })
      .join('');
    const tty = input.columns !== null;

    await new Application('lanes', { description: 'Write one lane message.' })
      .action(({ out }) => out[input.lane](message))
      .run({
        process: createProcess({
          argv: [],
          env: input.env ?? {},
          platform: 'linux',
          terminal: {
            columns: input.columns ?? 80,
            rows: 24,
            streams: tty ? ['stdout', 'stderr'] : [],
          },
        }),
        rendering: input.rendering,
      });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
