import { Application, Command } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';
import { mcp } from '@loomcli/plugins/mcp';
import { mcpArgument, mcpCommand } from '@loomcli/plugins/mcp/extension';

// The packed MCP plugin serves the opted-in Command as a tool, with the protocol inlined in its files.
const installed: Plugin = mcp();

const greet = new Command('greet', {
  description: 'Greet one subject.',
  extensions: [mcpCommand({ annotations: { readOnly: true } })],
})
  .argument('subject', {
    description: 'Who to greet.',
    extensions: [mcpArgument({ description: 'The name to greet.' })],
    required: true,
  })
  .action(({ args, out }) => out.print(`hello: ${args.subject}`));

const app = new Application('packed-mcp', { plugins: [installed], version: '1.0.0' }).command(
  greet,
);

await app.run({ host: { argv: process.argv.slice(2), release: { build: 'distributed' } } });
