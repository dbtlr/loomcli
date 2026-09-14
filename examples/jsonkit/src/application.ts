import { explain } from '@loom/explain';
import { explainCommand } from '@loom/explain/extension';
import {
  Application,
  FatalError,
  InputError,
  renderFailure,
  UnknownCommandError,
} from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpInput, helpCommand } from '@loomcli/plugins/help/extension';
import { version } from '@loomcli/plugins/version';

import Package from '../package.json' with { type: 'json' };
import { summarize } from './actions/summarize.js';
import { debug } from './commands/debug.js';
import { fetch } from './commands/fetch.js';
import { get } from './commands/get.js';
import { keys } from './commands/keys.js';
import { select } from './commands/select.js';
import { fatalError, inputProblems, unknownCommand } from './failures.js';
import { fileOrStdin } from './file-or-stdin.js';

// The root action type-imports this value, so it is registered by the last call.
const configured = new Application('jsonkit', {
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
  failures: [
    renderFailure(FatalError, fatalError),
    renderFailure(InputError, inputProblems),
    renderFailure(UnknownCommandError, unknownCommand),
  ],
  plugins: [help(), version(), explain()],
  version: Package.version,
}).globalOption('file', {
  description: 'The document to read. Omit it to read piped text.',
  extensions: [helpInput({ placeholder: 'path' })],
  short: 'f',
  type: 'string',
  validate: fileOrStdin,
  validateOmitted: true,
});

declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export const jsonkit = configured
  .command(get)
  .command(keys)
  .command(select)
  .command(fetch)
  .command(debug)
  .action(summarize);
