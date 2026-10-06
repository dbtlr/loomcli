import { explainCommand } from '@loom/explain/extension';
import { Command } from '@loomcli/core';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { mcpCommand } from '@loomcli/plugins/mcp/extension';

import { getValue } from '../actions/get-value.js';
import { pathFailures, readFailures } from '../failures.js';

export const get = new Command('get', {
  description: 'Read one value at a path.',
  extensions: [
    // An instruction an agent needs before it quotes a path, beyond what the help page says.
    manifestCommand({
      details: 'Quote a path that holds a shell metacharacter.',
      failures: [...pathFailures, ...readFailures],
    }),
    helpCommand({
      details: 'A path is a dot-separated walk from the root of the document.',
      examples: [
        { command: 'get name -f doc.json' },
        { command: 'get nested.deep.value -f doc.json' },
      ],
      section: ['Document commands', 'Read'],
    }),
    explainCommand({
      details: 'A path is a dot-separated walk from the root of the document.',
      examples: ['jsonkit get name -f doc.json', 'jsonkit get nested.deep.value -f doc.json'],
    }),
    mcpCommand({ annotations: { openWorld: false, readOnly: true } }),
  ],
})
  .argument('path', { description: 'Dot path to read.', required: true })
  .action(getValue);
