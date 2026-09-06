import { Command } from '@loom/core';
import { z } from 'zod';

import { selectFields } from '../actions/select-fields.js';
import { globals } from '../globals.js';

/** A field names a key, so the empty string can never name one. */
const NAMED = 1;

export const select = new Command('select', globals)
  .option('field', {
    multiple: true,
    required: true,
    short: 'F',
    type: 'string',
    validate: z.array(z.string().min(NAMED, 'Field names cannot be empty.')),
  })
  .action(selectFields);
