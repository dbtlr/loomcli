import { Application, Command } from '@loomcli/core';
import { z } from 'zod';

import { clearCache } from './clear-cache.js';

// Three named levels share one globals value: the root, the `cache` group, and its leaf Commands.
const clear = new Command('clear')
  .option('force', { short: 'F', type: 'boolean' })
  .action(clearCache);

const list = new Command('list')
  .option('long', { short: 'l', type: 'boolean' })
  .action(({ options, out }) => out.print(String(options.long)));

// A group registers no action, so it keeps `option()` and `command()` open.
const cache = new Command('cache').command(clear).command(list);

const nested = new Application('nested')
  .globalOption('file', { required: true, short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: z.string().transform(Number) })
  .command(cache);

export { clear, list, cache, nested };
