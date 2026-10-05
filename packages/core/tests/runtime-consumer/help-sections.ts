import { Application, Command } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';

const read = new Command('read', {
  description: 'Read work.',
  extensions: [helpCommand({ section: ['Work', 'Read'] })],
})
  .option('format', {
    description: 'Select the format.',
    extensions: [helpInput({ section: ['Output'] })],
    short: 'f',
    type: 'string',
  })
  .action(() => {});
const edit = new Command('edit', {
  description: 'Edit work.',
  extensions: [helpCommand({ section: ['Work', 'Edit'] })],
}).action(() => {});

const app = new Application('grouped', {
  extensions: [
    helpCommand({
      commandSections: [
        ['work', 'read'],
        ['Work', 'Edit'],
      ],
    }),
  ],
  plugins: [help()],
})
  .globalOption('quiet', {
    description: 'Say less.',
    extensions: [helpInput({ section: ['output'] })],
    short: 'q',
    type: 'boolean',
  })
  .command(edit)
  .command(read);

process.exitCode = await app.run({ host: { argv: process.argv.slice(2) } });
