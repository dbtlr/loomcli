import type { EnvironmentOf } from '@loomcli/core';
import { Application, Command } from '@loomcli/core';
import { z } from 'zod';

import { countFields } from './count-fields.js';
import { selectFields } from './select-fields.js';
import { setField } from './set-field.js';

// One local name and one local alias, declared with a different value shape on each Command.
const spellingGlobals = new Application('globals').globalOption('file', {
  short: 'f',
  type: 'string',
});

const select = new Command('select')
  .option('field', { multiple: true, short: 'F', type: 'string' })
  .option('raw', { type: 'boolean' })
  .action(selectFields);

const count = new Command('count')
  .option('field', { polarity: 'both', short: 'F', type: 'boolean' })
  .option('total', { type: 'boolean' })
  .action(countFields);

const set = new Command('set')
  .option('field', {
    short: 'F',
    type: 'string',
    validate: z.string().transform((value) => value.length),
  })
  .option('dry', { type: 'boolean' })
  .action(setField);

const cache = new Command('cache').command(set);

const spellings = new Application('spellings')
  .globalOption('file', { short: 'f', type: 'string' })
  .command(select)
  .command(count)
  .command(cache)
  .action(({ options }) => {
    const file: string | undefined = options.file;
    // @ts-expect-error TS2339: A child Command's local option never reaches the root handler.
    options.field;
    return file;
  });

const configured = new Application('registered').globalOption('file', {
  short: 'f',
  type: 'string',
});
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export { spellingGlobals, select, count, set, cache, spellings };
