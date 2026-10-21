// The module throws while it loads, because two options claim one spelling.
import { Command } from '@loomcli/core';

export const list = new Command('list')
  .option('verbose', { short: 'v', type: 'boolean' })
  .option('version', { short: 'v', type: 'boolean' });
