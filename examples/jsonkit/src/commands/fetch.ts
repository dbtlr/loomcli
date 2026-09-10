import { Command } from '@loomcli/core';

import { getValue } from '../actions/get-value.js';
import { globals } from '../globals.js';

// `fetch` is the former spelling of `get`.
// It still routes and runs, and every listing shows the migration message beside it.
export const fetch = new Command('fetch', {
  deprecated: 'Use get instead.',
  description: 'Read one value at a path.',
  globals,
})
  .argument('path', { description: 'Dot path to read.', required: true })
  .action(getValue);
