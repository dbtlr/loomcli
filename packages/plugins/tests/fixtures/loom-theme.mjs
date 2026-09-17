import { Application, style, plugin } from '@loomcli/core';
import { loomTheme, theme } from '@loomcli/plugins/theme';

const input = JSON.parse(process.argv[2]);
const overrides =
  input.overrides &&
  Object.fromEntries(
    Object.entries(input.overrides).map(([name, chain]) => [
      name,
      chain === null
        ? undefined
        : chain.reduce(
            (current, step) =>
              Array.isArray(step) ? current[step[0]](...step.slice(1)) : current[step],
            style,
          ),
    ]),
  );
if (input.invalidValue) {
  const invalid = {
    applied: style.red('x'),
    null: null,
    reserved: style.red,
    semantic: style.info,
  };
  overrides[input.invalidValue === 'reserved' ? 'red' : 'highlight'] = invalid[input.invalidValue];
}
let plugins = [loomTheme(overrides)];
if (input.bare) {
  plugins = [theme({})];
}
if (input.absent) {
  plugins = [];
}
if (input.collision === 'identity') {
  plugins.push(theme({}));
}
if (input.collision === 'slot') {
  plugins.push(plugin('another', { theme: {} }));
}
const app = new Application('palette', { plugins }).action(({ out, style: contextual }) => {
  const tokens = input.tokens ?? [
    'primary',
    'dim',
    'highlight',
    'success',
    'warning',
    'error',
    'info',
  ];
  let text = tokens.map((name) => contextual[name](name)).join('|');
  if (input.literal) {
    text = input.literal;
  }
  if (input.outer) {
    text = style.red.bgBlue.bold(text);
  }
  out.render(text, { render: (value) => value });
});
await app.run({
  host: {
    argv: [],
    env: input.env ?? {},
    terminal: {
      stderr: { isTTY: false },
      stdin: { isTTY: false },
      stdout: { isTTY: input.tty ?? false },
    },
  },
  rendering: input.rendering,
});
