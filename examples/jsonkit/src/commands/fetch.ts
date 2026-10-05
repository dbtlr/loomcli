import { Command } from '@loomcli/core';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

import { getValue } from '../actions/get-value.js';
import { pathFailures, readFailures } from '../failures.js';

// `fetch` is the former spelling of `get`.
// It still routes and runs, and its help rows and page show the migration message beside it.
export const fetch = new Command('fetch', {
  deprecated: 'Use get instead.',
  description: 'Read one value at a path.',
  extensions: [
    manifestCommand({ failures: [...pathFailures, ...readFailures] }),
    helpCommand({ section: ['Document commands', 'Read'] }),
  ],
})
  .argument('path', { description: 'Dot path to read.', required: true })
  .action(getValue);
