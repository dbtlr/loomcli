import { Command } from '@loomcli/core';

// The declaration below throws as the module evaluates, because two options claim one spelling.
export const list = new Command('list')
  .option('verbose', { short: 'v', type: 'boolean' })
  .option('version', { short: 'v', type: 'boolean' });
