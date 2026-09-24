import { Application, Command, readExtension } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

/**
 * The packed manifest declarations module, read with no manifest plugin installed. The author's
 * value and the value the packed help hook supplies collect on one Command, author first.
 */
const supplier = new Application('supplier', { plugins: [help()] }).command(
  new Command('read', {
    extensions: [
      manifestCommand({ details: 'Only an agent needs this.' }),
      helpCommand({ examples: [{ command: 'read x' }] }),
    ],
  }).action(() => {}),
);

const [read] = supplier.inspect().root.children;
process.stdout.write(`${JSON.stringify(read ? readExtension(read, manifestCommand) : null)}\n`);
