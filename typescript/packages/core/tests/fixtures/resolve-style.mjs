import { Application, glyph, nowrap, pad, plugin, style } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    const input = JSON.parse(words[0]);
    // A development build, so a broken color helper prints its Developer Diagnostic.
    const app = new Application('resolve', {
      description: 'Resolve styled text.',
      plugins: input.themes?.map((mapping, index) =>
        plugin(`theme-${index}`, {
          theme: Object.fromEntries(
            Object.entries(mapping).map(([name, chain]) => [
              name,
              chain === null
                ? undefined
                : chain.reduce(
                    (current, step) =>
                      Array.isArray(step) ? current[step[0]](...step.slice(1)) : current[step],
                    style,
                  ),
            ]),
          ),
        }),
      ),
      rendering: input.rendering,
    }).action(({ out }) => {
      if (input.nowrapProbe) {
        out.print(style.escape(nowrap('a b')));
        try {
          nowrap(1);
        } catch (error) {
          out.print(`${error.name}: ${error.message}`);
        }
        return;
      }
      for (let text of input.texts ?? [input.text]) {
        if (input.repeat) {
          text = text.repeat(input.repeat);
        }
        if (input.nest) {
          const marker = pad('', input.nest.width);
          text =
            marker.slice(0, -1).repeat(input.nest.depth) + text + '\uE002'.repeat(input.nest.depth);
        }
        if (input.glyph) {
          text = input.glyph === 'all' ? Object.values(glyph).join('\n') : glyph[input.glyph];
        }
        if (input.chain) {
          text = input.chain.reduce(
            (current, step) =>
              Array.isArray(step) ? current[step[0]](...step.slice(1)) : current[step],
            style,
          )(text);
        }
        for (let index = 0; index < (input.escapeTimes ?? 0); index += 1) {
          text = style.escape(text);
        }
        if (input.nowrap) {
          text = nowrap(text);
        }
        if (input.pad !== undefined) {
          text = pad(text, input.pad, { align: input.align });
        }
        out.render(text, {
          render: (value, context) => {
            if (input.measure) {
              return String(context.width(value));
            }
            if (input.contextKey) {
              return context.style[input.contextKey](value);
            }
            return value;
          },
        });
      }
    });
    await app.run({
      process: createProcess({
        argv: [],
        env: input.env ?? {},
        platform: input.platform ?? 'linux',
        terminal: { columns: 80, rows: 24, streams: input.tty ? ['stdout'] : [] },
      }),
      rendering: input.runRendering,
    });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
