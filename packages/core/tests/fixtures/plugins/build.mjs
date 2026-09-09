import { Application, DeclarationError, plugin } from '@loomcli/core';

const dispatch = ({ out }) => out.print('dispatched');

const scenarios = {
  'empty-identity': () => new Application('app', { plugins: [plugin('', {})] }).action(dispatch),
  installed: () =>
    new Application('app', { plugins: [plugin('@loomcli/help', {})] }).action(dispatch),
  'installed-twice': () =>
    new Application('app', {
      plugins: [plugin('@loomcli/help', {}), plugin('@loomcli/help', {})],
    }).action(dispatch),
  'not-a-plugin': () =>
    new Application('app', { plugins: [{ identity: '@loomcli/help' }] }).action(dispatch),
};

const build = scenarios[process.argv[2]];
const mode = process.argv[3];

if (mode === 'inspect') {
  try {
    build().inspect();
    process.stdout.write('inspected\n');
  } catch (error) {
    const kind = error instanceof DeclarationError ? 'declaration' : 'other';
    process.stdout.write(`${kind}:${error.exitCode}: ${error.message}\n`);
  }
} else {
  const code = await build().run({ host: { argv: [] } });
  process.stdout.write(`resolved:${code}\n`);
}
