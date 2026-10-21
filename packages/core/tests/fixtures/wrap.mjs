import { Application, glyph, nowrap, pad, style } from '@loomcli/core';

const input = JSON.parse(process.argv[2]);
// JSON holds no NaN or Infinity, so a width spelled as a string is read as a number.
const columns =
  typeof input.columns === 'string' ? Number(input.columns) : (input.columns ?? undefined);

/** Marked text built from a small description: strings, frames, styles, and glyphs. */
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
  host: {
    argv: [],
    env: input.env ?? {},
    platform: 'linux',
    terminal: {
      stderr: { columns: undefined, isTTY: false, rows: undefined },
      stdin: { isTTY: false },
      stdout: { columns: undefined, isTTY: input.tty ?? false, rows: undefined },
    },
  },
  rendering: input.rendering,
});
