import { explain } from '@loom/explain';
import { explainCommand } from '@loom/explain/extension';
import { Application, InputError, renderFailure, UnknownCommandError } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { version } from '@loomcli/plugins/version';

import Package from '../package.json' with { type: 'json' };
import { summarize } from './actions/summarize.js';
import { get } from './commands/get.js';
import { keys } from './commands/keys.js';
import { select } from './commands/select.js';
import { inputProblems, unknownCommand } from './failures.js';
import { globals } from './globals.js';

// The root action type-imports this value, so it is registered by the last call.
export const jsonkit = new Application('jsonkit', {
  description: 'Read and reshape one JSON document.',
  extensions: [
    helpCommand({
      details: 'With no subcommand, jsonkit summarizes the document and its top-level keys.',
      examples: [{ command: '-f doc.json' }, { command: 'get user.name -f doc.json' }],
    }),
    explainCommand({
      details: 'With no subcommand, jsonkit summarizes the document and its top-level keys.',
      examples: ['jsonkit -f doc.json', 'jsonkit get user.name -f doc.json'],
    }),
  ],
  // The two failures an operator meets most carry this application's own wording.
  // Every other class keeps core's text.
  failures: [
    renderFailure(InputError, inputProblems),
    renderFailure(UnknownCommandError, unknownCommand),
  ],
  globals,
  plugins: [help(), version(), explain()],
  version: Package.version,
})
  .command(get)
  .command(keys)
  .command(select)
  .action(summarize);
