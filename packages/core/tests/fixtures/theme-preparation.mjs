import { Application, Command, DeclarationError, override, plugin, style } from '@loomcli/core';

const scenario = process.argv[2];
const invalid = override(DeclarationError, {
  render: (_failure, context) => `${context.style.issue('invalid')}\n`,
});
const app = new Application('theme-preparation', {
  plugins: [
    plugin('palette', { theme: { issue: style.cyan } }),
    ...(scenario === 'view-registry'
      ? [plugin('invalid-registry', { views: [invalid, invalid] })]
      : []),
  ],
  rendering: { color: 'always' },
  views: [invalid],
});
const configured =
  scenario === 'graph'
    ? app.command(new Command('duplicate')).command(new Command('duplicate'))
    : app.option('flag', { required: true, type: 'boolean' }).action(() => undefined);
await configured.run({ host: { argv: [], env: {} } });
