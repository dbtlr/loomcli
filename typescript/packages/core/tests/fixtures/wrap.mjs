import { Application, glyph, nowrap, pad, style } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    const input = JSON.parse(words[0]);
    // JSON holds no NaN or Infinity, so a width spelled as a string is read as a number.
    const columns =
      typeof input.columns === 'string' ? Number(input.columns) : (input.columns ?? undefined);

    /** Marked text built from a small description: strings, frames, styles, and glyphs. */

    const app = new Application('wrap', { description: 'Wrap text.' }).action(({ out }) =>
      out.render(build(input.text), {
        render: (text, context) => {
          if (input.expand) {
            return context.expandTabs(text);
          }
          try {
            const wrapped = context.wrap(text, columns);
            return input.center ? pad(wrapped, columns, { align: 'center' }) : wrapped;
          } catch (error) {
            return `${error.name}: ${error.message}`;
          }
        },
      }),
    );
    await app.run({
      process: createProcess({
        argv: [],
        env: input.env ?? {},
        platform: 'linux',
        terminal: { columns: 80, rows: 24, streams: input.tty ? ['stdout'] : [] },
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

function build(part) {
  if (typeof part === 'string') {
    return part;
  }
  if (Array.isArray(part)) {
    return part.map(build).join('');
  }
  if ('nowrap' in part) {
    return nowrap(build(part.nowrap));
  }
  if ('pad' in part) {
    const [body, width, align] = part.pad;
    return pad(build(body), width, { align });
  }
  if ('style' in part) {
    const [steps, body] = part.style;
    return steps.reduce((chain, step) => chain[step], style)(build(body));
  }
  if ('glyph' in part) {
    return glyph[part.glyph];
  }
  throw new Error(`Unknown part: ${JSON.stringify(part)}`);
}

export { runFixture as run };
