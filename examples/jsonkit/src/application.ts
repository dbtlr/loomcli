import { Application, InputError, renderFailure, UnknownCommandError } from '@loom/core';

import { summarize } from './actions/summarize.js';
import { get } from './commands/get.js';
import { keys } from './commands/keys.js';
import { select } from './commands/select.js';
import { inputProblems, unknownCommand } from './failures.js';
import { globals } from './globals.js';

// The root action type-imports this value, so it is registered by the last call.
export const jsonkit = new Application('jsonkit', {
  // The two failures an operator meets most carry this application's own wording; every other
  // Class keeps core's text.
  failures: [
    renderFailure(InputError, inputProblems),
    renderFailure(UnknownCommandError, unknownCommand),
  ],
  globals,
})
  .command(get)
  .command(keys)
  .command(select)
  .action(summarize);
