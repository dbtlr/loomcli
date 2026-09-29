// JavaScript, so no type check stops the call: the module throws while it loads.
import { Command } from '@loomcli/core';

export const list = new Command('list').option('verbose', { multiple: true, type: 'boolean' });
