import { Command } from '@loomcli/core';
import { helpCommand } from '@loomcli/plugins/help/extension';

const greet = new Command('greet', {
  description: 'Greet a subject.',
  extensions: [helpCommand({ details: 'Library details.', examples: [{ command: 'greet old' }] })],
})
  .argument('subject', { required: true })
  .action(({ args, out }) => out.print(`hello: ${args.subject}`));

export { greet };
