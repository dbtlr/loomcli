// JavaScript intentionally supplies both mutually exclusive mcpInput keys, which the types reject.
import { Application, Command } from '@loomcli/core';
import { mcp } from '@loomcli/plugins/mcp';
import { mcpCommand, mcpInput } from '@loomcli/plugins/mcp/extension';

export function bothKeysScenario() {
  return new Application('app', { description: 'A faulty fixture.', plugins: [mcp()] }).command(
    new Command('get', { description: 'Get.', extensions: [mcpCommand({})] })
      .option('file', {
        description: 'The file.',
        extensions: [mcpInput({ description: 'A file.', exclude: true })],
        type: 'string',
      })
      .action(({ out }) => out.print('dispatched')),
  );
}

// JavaScript intentionally supplies min on a scalar content option, which the types reject.
export function requiredContentExcluded() {
  return new Application('app', { description: 'A faulty fixture.', plugins: [mcp()] })
    .command(
      new Command('get', { description: 'Get.', extensions: [mcpCommand({})] })
        .option('file', {
          description: 'The file.',
          extensions: [mcpInput({ exclude: true })],
          min: 1,
          type: 'content',
        })
        .action(({ out }) => out.print('dispatched')),
    )
    .command(
      new Command('plain', { description: 'Plain.' }).action(({ out }) => out.print('dispatched')),
    );
}
