import { Command } from '@loom/core';

import { listKeys } from '../actions/list-keys.js';
import { globals } from '../globals.js';

export const keys = new Command('keys', globals).action(listKeys);
