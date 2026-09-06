import { Application, GlobalOptions } from '@loom/core';
import type { StringOption } from '@loom/core';
import { z } from 'zod';

const names = z.array(z.string()).transform((values) => values.length);
const field = { multiple: true, short: 'F', type: 'string' } satisfies StringOption;

new Application('multiple')
  .option('field', field)
  .option('metric', { type: 'string' })
  .action(({ options }) => {
    const fields: string[] = options.field;
    // @ts-expect-error TS2322: A multiple option collects its occurrences, never one string.
    const single: string = options.field;
    // @ts-expect-error TS2322: Omission produces the empty array, so the value is never undefined.
    const absent: undefined = options.field;
    return { absent, fields, single };
  });

new Application('multiple-schema')
  .option('field', { multiple: true, type: 'string', validate: names })
  .option('required', { multiple: true, required: true, type: 'string' })
  .option('defaulted', { default: ['a'], multiple: true, type: 'string' })
  .action(({ options }) => {
    const count: number = options.field;
    const required: string[] = options.required;
    const defaulted: string[] = options.defaulted;
    // @ts-expect-error TS2322: A required multiple option adds no undefined to its collection.
    const maybeRequired: undefined = options.required;
    return { count, defaulted, maybeRequired, required };
  });

new GlobalOptions().option('field', { multiple: true, type: 'string' });

const rawDefault = { default: 'a', multiple: true, type: 'string' } satisfies StringOption;
// @ts-expect-error TS2345: A raw multiple default is a string array, not one string.
new Application('bad').option('field', rawDefault);
const stringSchema = {
  multiple: true,
  type: 'string',
  validate: z.string(),
} satisfies StringOption;
// @ts-expect-error TS2345: A multiple schema reads the whole array, so a string input cannot serve.
new Application('bad').option('field', stringSchema);
const schemaDefault = {
  default: 'a',
  multiple: true,
  type: 'string',
  validate: names,
} satisfies StringOption;
// @ts-expect-error TS2345: A validated multiple default uses the schema input type.
new Application('bad').option('field', schemaDefault);
// @ts-expect-error TS2345: Boolean options declare no multiple.
new Application('bad').option('verbose', { multiple: true, type: 'boolean' });
const listDefault = { default: ['a'], type: 'string' } satisfies StringOption;
// @ts-expect-error TS2345: A single-value option keeps its string default.
new Application('bad').option('metric', listDefault);
