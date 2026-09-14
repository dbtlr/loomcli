import { Application, style, pad, glyph, plugin } from '@loomcli/core';

const input = JSON.parse(process.argv[2]);
const app = new Application('resolve', {
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
  host: {
    argv: [],
    env: input.env ?? {},
    platform: input.platform ?? 'linux',
    terminal: {
      stderr: { isTTY: false },
      stdin: { isTTY: false },
      stdout: { isTTY: input.tty ?? false },
    },
  },
  rendering: input.runRendering,
});
