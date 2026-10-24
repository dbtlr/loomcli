import {
  Application,
  DeclarationError,
  override,
  plugin,
  processHandle,
  style,
} from '@loomcli/core';

const scenario = process.argv[2];
const invalid = override(DeclarationError, {
  render: (_failure, context) => `${context.style.issue('invalid')}\n`,
});

/** A hook that rejects the Command with a declaration fault, which only the graph build meets. */
const failing = plugin('failing', {
  onCommandAttach: () => {
    throw new DeclarationError('The hook rejects the Command.');
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
await configured.run({
  process: processHandle({ argv: [], env: {}, release: { build: 'distributed' } }),
});
