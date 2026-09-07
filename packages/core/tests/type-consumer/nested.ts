import { Application, Command } from '@loom/core';

import { clearCache } from './clear-cache.js';
import { globals } from './commands.js';

// Three named levels share one globals value: the root, the `cache` group, and its leaf Commands.
export const clear = new Command('clear', globals)
  .option('force', { short: 'F', type: 'boolean' })
  .action(clearCache);

export const list = new Command('list', globals)
  .option('long', { short: 'l', type: 'boolean' })
  .action(({ options, out }) => out.print(String(options.long)));

// A group registers no action, so it keeps `option()` and `command()` open.
export const cache = new Command('cache', globals).command(clear).command(list);

export const nested = new Application('nested', { globals }).command(cache);
