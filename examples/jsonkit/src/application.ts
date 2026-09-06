import { Application } from '@loom/core';

import { summarize } from './actions/summarize.js';
import { get } from './commands/get.js';
import { keys } from './commands/keys.js';
import { select } from './commands/select.js';
import { globals } from './globals.js';

// The root action type-imports this value, so it is registered by the last call.
export const jsonkit = new Application('jsonkit', globals)
  .command(get)
  .command(keys)
  .command(select)
  .action(summarize);
