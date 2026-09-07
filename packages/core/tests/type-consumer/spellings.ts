import { Application, Command, GlobalOptions } from '@loom/core';
import { z } from 'zod';

import { countFields } from './count-fields.js';
import { selectFields } from './select-fields.js';
import { setField } from './set-field.js';

// One local name and one local alias, declared with a different value shape on each Command.
export const spellingGlobals = new GlobalOptions().option('file', { short: 'f', type: 'string' });

export const select = new Command('select', spellingGlobals)
  .option('field', { multiple: true, short: 'F', type: 'string' })
  .option('raw', { type: 'boolean' })
  .action(selectFields);

export const count = new Command('count', spellingGlobals)
  .option('field', { polarity: 'both', short: 'F', type: 'boolean' })
  .option('total', { type: 'boolean' })
  .action(countFields);

export const set = new Command('set', spellingGlobals)
  .option('field', {
    short: 'F',
    type: 'string',
    validate: z.string().transform((value) => value.length),
  })
  .option('dry', { type: 'boolean' })
  .action(setField);

export const cache = new Command('cache', spellingGlobals).command(set);

export const spellings = new Application('spellings', { globals: spellingGlobals })
  .command(select)
  .command(count)
  .command(cache)
  .action(({ options }) => {
    const file: string | undefined = options.file;
    // @ts-expect-error TS2339: A child Command's local option never reaches the root handler.
    options.field;
    return file;
  });
