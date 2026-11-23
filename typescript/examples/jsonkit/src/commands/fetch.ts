import { Command } from '@loomcli/core';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

import { getValue } from '../actions/get-value.js';
import { documentInput } from '../document-input.js';
import { pathFailures, readFailures } from '../failures.js';
import { jsonLayout } from '../json-layout.js';

// `fetch` is the former spelling of `get`.
// It still routes and runs, and its help rows and page show the migration message beside it.
// It shares the action of `get`, so it applies the same option set and reads the same options.
export const fetch = new Command('fetch', {
  deprecated: 'Use get instead.',
  description: 'Read one value at a path.',
  extensions: [
    manifestCommand({ failures: [...pathFailures, ...readFailures] }),
    helpCommand({ section: ['Document commands', 'Read'] }),
  ],
})
  .option('file', documentInput)
  .options(jsonLayout)
  .argument('path', { description: 'Dot path to read.', required: true })
  .action(getValue);
