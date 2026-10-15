import { Application, Command } from '@loomcli/core';
import { mcp } from '@loomcli/plugins/mcp';
import { mcpCommand } from '@loomcli/plugins/mcp/extension';

import { text } from '../../dist/index.js';

const port = new Command('port', { description: 'Configure a port.', extensions: [mcpCommand({})] })
  .option('port', { description: 'Service port.', required: 'non-interactive', type: 'string' })
  .action(async (context) => {
    await context.out.print(
      String(await text(context, { message: 'Service port', option: 'port' })),
    );
  });
const question = new Command('question', {
  description: 'Ask a question.',
  extensions: [mcpCommand({})],
}).action(async (context) => {
  await text(context, { message: 'Name' });
});
const app = new Application('setup', { description: 'Configure a service.', plugins: [mcp()] })
  .command(port)
  .command(question);
process.exitCode = await app.run();
