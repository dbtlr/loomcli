import { Command } from '@loomcli/core';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { text } from '@loomcli/validators';

import { selectFields } from '../actions/select-fields.js';
import { readFailures } from '../failures.js';

export const select = new Command('select', {
  description: 'Keep the named fields of the document.',
  extensions: [
    manifestCommand({ failures: readFailures }),
    helpCommand({ section: ['Document commands', 'Reshape'] }),
  ],
})
  .option('field', {
    description: 'A field to keep. Repeat it for several.',
    multiple: true,
    required: true,
    short: 'F',
    type: 'string',
    // A field names a key, so the empty string can never name one.
    validate: text(),
  })
  .action(selectFields);
