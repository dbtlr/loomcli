import { Application, DeclarationError, override, plugin, style } from '@loomcli/core';

const scenario = process.argv[2];
const invalid = override(DeclarationError, {
  render: (_failure, context) => `${context.style.issue('invalid')}\n`,
});

/** A hook that fails, which only the graph build meets. */
const failing = plugin('failing', {
  onCommandAttach: () => {
    throw new Error('The hook broke.');
  },
});

const app = new Application('theme-preparation', {
  plugins: [
    plugin('palette', { theme: { issue: style.cyan } }),
    ...(scenario === 'hook' ? [failing] : []),
  ],
  rendering: { color: 'always' },
  views: [invalid],
});
// A root with neither children nor an action is final only at build, so both scenarios build and fail.
const configured = scenario === 'hook' ? app.action(() => undefined) : app;
await configured.run({ host: { argv: [], env: {} } });
