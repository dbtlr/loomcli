import { Command } from '@loomcli/core';

import { getValue } from '../actions/get-value.js';
import { globals } from '../globals.js';

export const get = new Command('get', globals)
  .argument('path', { required: true })
  .action(getValue);
