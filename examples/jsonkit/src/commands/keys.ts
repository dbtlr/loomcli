import { Command } from '@loomcli/core';

import { listKeys } from '../actions/list-keys.js';

// `ls` is an alias: it routes to this Command, and no projection advertises it.
export const keys = new Command('keys', { description: 'List the keys at a path.' })
  .alias('ls')
  .argument('path', { description: 'Dot path to list. Omit it for the root.' })
  .action(listKeys);
