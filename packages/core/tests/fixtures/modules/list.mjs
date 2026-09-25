import { Command } from '@loomcli/core';

// JavaScript, so no type check stops the call; the declaration below throws as the module evaluates.
export const list = new Command('list').option('verbose', { multiple: true, type: 'boolean' });
