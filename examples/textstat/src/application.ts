import { Application } from '@loom/core';
import { z } from 'zod';

import { countFiles } from './count-files.js';

export const textstat = new Application('textstat')
  .argument('files', { required: true, variadic: true })
  .option('metric', {
    default: 'bytes',
    short: 'm',
    type: 'string',
    validate: z.enum(['bytes', 'words', 'lines'], { error: 'Use bytes, words, or lines.' }),
  })
  .option('min-bytes', {
    default: '0',
    type: 'string',
    validate: z
      .string()
      .regex(/^[0-9]+$/, 'Use non-negative decimal digits.')
      .transform(Number)
      .refine(Number.isSafeInteger, 'Use a number within the safe integer range.'),
  })
  .option('total', { short: 't', type: 'boolean' })
  .action(countFiles);
