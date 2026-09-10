import { explainCommand } from '@loom/explain/extension';
import { Command } from '@loomcli/core';
import { helpCommand } from '@loomcli/plugins/help/extension';

import { getValue } from '../actions/get-value.js';
import { globals } from '../globals.js';

export const get = new Command('get', {
  description: 'Read one value at a path.',
  extensions: [
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
  globals,
})
  .argument('path', { description: 'Dot path to read.', required: true })
  .action(getValue);
