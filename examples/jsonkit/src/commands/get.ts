import { explainCommand } from '@loom/explain/extension';
import { Command } from '@loomcli/core';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

import { getValue } from '../actions/get-value.js';

export const get = new Command('get', {
  description: 'Read one value at a path.',
  extensions: [
    // An instruction an agent needs before it quotes a path, beyond what the help page says.
    manifestCommand({ details: 'Quote a path that holds a shell metacharacter.' }),
    helpCommand({
      details: 'A path is a dot-separated walk from the root of the document.',
      examples: [
        { command: 'get name -f doc.json' },
        { command: 'get nested.deep.value -f doc.json' },
      ],
    }),
    explainCommand({
      details: 'A path is a dot-separated walk from the root of the document.',
      examples: ['jsonkit get name -f doc.json', 'jsonkit get nested.deep.value -f doc.json'],
    }),
  ],
})
  .argument('path', { description: 'Dot path to read.', required: true })
  .action(getValue);
