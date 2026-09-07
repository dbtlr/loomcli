import { Command } from '@loom/core';

import { listKeys } from '../actions/list-keys.js';
import { globals } from '../globals.js';

// `ls` is a hidden alias: it routes to this Command, and no projection advertises it.
export const keys = new Command('keys', globals).alias('ls').argument('path', {}).action(listKeys);
