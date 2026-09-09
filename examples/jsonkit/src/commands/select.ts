import { Command } from '@loomcli/core';
import { z } from 'zod';

import { selectFields } from '../actions/select-fields.js';
import { globals } from '../globals.js';

export const select = new Command('select', {
  description: 'Keep the named fields of the document.',
  globals,
})
  .option('field', {
    description: 'A field to keep. Repeat it for several.',
    multiple: true,
    required: true,
    short: 'F',
    type: 'string',
    // A field names a key, so the empty string can never name one.
    validate: z.array(z.string().nonempty('Supply a nonempty field name.')),
  })
  .action(selectFields);
