import { Application, readExtension, style } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifest } from '@loomcli/plugins/manifest';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { theme } from '@loomcli/plugins/theme';

const input = JSON.parse(process.argv[2]);
const plugins = [help(), manifest()];
if (input.themed) {
  plugins.push(theme({ dim: style.magenta, highlight: style.cyan, primary: style.green }));
}
const app = new Application('app', { plugins })
  .extend(helpCommand({ details: input.details }))
  .action(() => {});
if (input.inspect) {
  const value = readExtension(app.inspect().root, manifestCommand);
  console.log(JSON.stringify(value));
} else {
  await app.run({
    host: { argv: input.argv ?? ['--help'], env: {} },
    rendering: input.rendering ?? { color: 'never', modifiers: 'never' },
  });
}
