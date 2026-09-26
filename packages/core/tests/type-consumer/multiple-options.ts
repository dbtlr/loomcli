import { Application } from '@loomcli/core';
import type { StringOption } from '@loomcli/core';
import { z } from 'zod';

const lengths = z.string().transform((value) => value.length);
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
  .option('field', { multiple: true, type: 'string', validate: lengths })
  .option('required', { multiple: true, required: true, type: 'string' })
  .option('defaulted', { default: ['a'], multiple: true, type: 'string' })
  .option('counted', { default: ['a', 'bb'], multiple: true, type: 'string', validate: lengths })
  .argument('files', { validate: lengths, variadic: true })
  .action(({ args, options }) => {
    const counts: number[] = options.field;
    const defaultCounts: number[] = options.counted;
    const fileCounts: number[] = args.files;
    // @ts-expect-error TS2322: Each value passes the validator, so the action receives an array.
    const count: number = options.field;
    const required: string[] = options.required;
    const defaulted: string[] = options.defaulted;
    // @ts-expect-error TS2322: A required multiple option adds no undefined to its collection.
    const maybeRequired: undefined = options.required;
    return { count, counts, defaultCounts, defaulted, fileCounts, maybeRequired, required };
  });

new Application('globals').globalOption('field', { multiple: true, type: 'string' });

const rawDefault = { default: 'a', multiple: true, type: 'string' } satisfies StringOption;
// @ts-expect-error TS2345: A raw multiple default is a string array, not one string.
new Application('bad').option('field', rawDefault);
const arrayValidator = {
  multiple: true,
  type: 'string',
  validate: z.array(z.string()),
} satisfies StringOption;
// @ts-expect-error TS2345: A multiple validator reads one value, so an array input cannot serve.
new Application('bad').option('field', arrayValidator);
// @ts-expect-error TS2345: A variadic validator reads one value, so an array input cannot serve.
new Application('bad').argument('files', { validate: z.array(z.string()), variadic: true });
const validatorDefault = {
  default: 'a',
  multiple: true,
  type: 'string',
  validate: lengths,
} satisfies StringOption;
// @ts-expect-error TS2345: A validated multiple default is an array of the validator's input.
new Application('bad').option('field', validatorDefault);
// @ts-expect-error TS2345: Boolean options declare no multiple.
new Application('bad').option('verbose', { multiple: true, type: 'boolean' });
const listDefault = { default: ['a'], type: 'string' } satisfies StringOption;
// @ts-expect-error TS2345: A single-value option keeps its string default.
new Application('bad').option('metric', listDefault);
