import { Command } from '@loomcli/core';
import { z } from 'zod';

import { selectFields } from '../actions/select-fields.js';
import { globals } from '../globals.js';

export const select = new Command('select', globals)
  .option('field', {
    multiple: true,
    required: true,
    short: 'F',
    type: 'string',
    // A field names a key, so the empty string can never name one.
    validate: z.array(z.string().nonempty('Supply a nonempty field name.')),
  })
  .action(selectFields);
