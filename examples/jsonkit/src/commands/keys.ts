import { Command } from '@loomcli/core';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { mcpCommand } from '@loomcli/plugins/mcp/extension';

import { listKeys } from '../actions/list-keys.js';
import { pathFailures, readFailures } from '../failures.js';

// `ls` is an alias: it routes to this Command, and no projection advertises it.
export const keys = new Command('keys', {
  description: 'List the keys at a path.',
  extensions: [
    manifestCommand({ failures: [...pathFailures, ...readFailures] }),
    helpCommand({ section: ['Document commands', 'Read'] }),
    mcpCommand({ annotations: { openWorld: false, readOnly: true } }),
  ],
})
  .alias('ls')
  .argument('path', { description: 'Dot path to list. Omit it for the root.' })
  .action(listKeys);
