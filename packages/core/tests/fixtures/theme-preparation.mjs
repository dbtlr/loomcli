import {
  Application,
  Command,
  DeclarationError,
  plugin,
  renderFailure,
  style,
} from '@loomcli/core';

const scenario = process.argv[2];
const renderer = renderFailure(DeclarationError, {
  render: (_failure, context) => `${context.style.issue('invalid')}\n`,
});
const app = new Application('theme-preparation', {
  failures: [renderer],
  plugins: [
    plugin('palette', { theme: { issue: style.cyan } }),
    ...(scenario === 'failure-registry'
      ? [plugin('invalid-registry', { failures: [renderer, renderer] })]
      : []),
  ],
  rendering: { color: 'always' },
});
const configured =
  scenario === 'graph'
    ? app.command(new Command('duplicate')).command(new Command('duplicate'))
    : app.option('flag', { required: true, type: 'boolean' }).action(() => undefined);
await configured.run({ host: { argv: [], env: {} } });
