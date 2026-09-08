import { Application } from '@loomcli/core';
import type { ActionHandler, StringOption } from '@loomcli/core';
import { z } from 'zod';

const number = z.string().transform(Number);
const config = { default: '0', type: 'string', validate: number } satisfies StringOption;
const app = new Application('schema-types')
  .argument('files', {
    required: true,
    validate: z.array(z.string()).transform((files) => files.length),
    variadic: true,
  })
  .option('minimum', config)
  .option('optional', { type: 'string', validate: number })
  .option('required', { required: true, type: 'string', validate: number })
  .option('raw', { default: 'text', type: 'string' })
  .option('maybe', {
    default: 'text',
    type: 'string',
    validate: z.string().transform(() => undefined),
  });

const handler: ActionHandler<typeof app> = ({ args, options }) => {
  const count: number = args.files;
  const minimum: number = options.minimum;
  const optional: number | undefined = options.optional;
  const required: number = options.required;
  const raw: string = options.raw;
  const maybe: undefined = options.maybe;
  // @ts-expect-error TS2322: transformed output is numeric, not its input string
  const wrong: string = options.minimum;
  // @ts-expect-error TS2322: omission remains possible without a declared default
  const missing: number = options.optional;
  return { count, maybe, minimum, missing, optional, raw, required, wrong };
};
app.action(handler);

const wrongSchemaDefault = { default: 10, type: 'string', validate: number } satisfies StringOption;
// @ts-expect-error TS2345: a transforming schema default uses its input type
new Application('bad').option('size', wrongSchemaDefault);
// @ts-expect-error TS2345: required values cannot declare defaults
new Application('bad').option('size', { default: '10', required: true, type: 'string' });
// @ts-expect-error TS2345: Boolean options do not accept schemas
new Application('bad').option('flag', { type: 'boolean', validate: z.boolean() });
// @ts-expect-error TS2345: required variadic arguments cannot declare defaults
new Application('bad').argument('files', { default: [], required: true, variadic: true });
const wrongRawDefault = { default: 10, type: 'string' } satisfies StringOption;
// @ts-expect-error TS2345: raw value defaults must be strings
new Application('bad').option('size', wrongRawDefault);
// @ts-expect-error TS2322: validate takes a Standard Schema object, not a callback
new Application('bad').option('size', { type: 'string', validate: (value: string) => value });

const widened: StringOption = Math.random() > 0.5 ? config : { type: 'string' };
new Application('widened').option('size', widened).action(({ options }) => {
  // @ts-expect-error TS2322: a widened schema configuration cannot promise raw strings
  const unsafe: string | undefined = options.size;
  return unsafe;
});

const rawArgument = { mode: 'raw', required: true, variadic: true } satisfies {
  mode: 'raw';
  required: true;
  variadic: true;
};
const transformedArgument = {
  mode: 'schema',
  required: true,
  validate: z.array(z.string()).transform((files) => files.length),
  variadic: true,
} satisfies { mode: 'schema'; required: true; variadic: true; validate: unknown };
const conditionalArgument = Math.random() > 0.5 ? rawArgument : transformedArgument;
new Application('conditional').argument('files', conditionalArgument).action(({ args }) => {
  const either: string[] | number = args.files;
  // @ts-expect-error TS2322: a conditional schema can transform the array into a number
  const unsafe: string[] = args.files;
  return { either, unsafe };
});

const arrayInput = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (typeof value === 'string' ? value : value.join(',')));
new Application('array-default')
  .option('tags', { default: ['a', 'b'], type: 'string', validate: arrayInput })
  .action(({ options }) => {
    const text: string = options.tags;
    return text;
  });
const nestedInput = z
  .union([z.string(), z.object({ tags: z.array(z.string()) })])
  .transform((value) => (typeof value === 'string' ? value : value.tags.length));
new Application('nested-default')
  .option('tags', { default: { tags: ['a', 'b'] }, type: 'string', validate: nestedInput })
  .action(({ options }) => {
    const value: string | number = options.tags;
    return value;
  });
new Application('async-types')
  .option('value', {
    required: true,
    type: 'string',
    validate: z.string().transform(async (text) => text.length),
  })
  .action(({ options }) => {
    const value: number = options.value;
    return value;
  });
new Application('element-types')
  .argument('values', { required: true, validate: z.array(number), variadic: true })
  .action(({ args }) => {
    const values: number[] = args.values;
    return values;
  });

const plainDefault = { default: 'a', mode: 'raw', type: 'string' } satisfies StringOption & {
  mode: 'raw';
};
const arrayDefault = {
  default: ['a'],
  mode: 'schema',
  type: 'string',
  validate: arrayInput,
} satisfies StringOption & { mode: 'schema' };
const mixedDefault = Math.random() > 0.5 ? plainDefault : arrayDefault;
new Application('mixed-default').option('tags', mixedDefault).action(({ options }) => {
  const value: string = options.tags;
  return value;
});
const badPlainDefault = { default: ['a'], mode: 'raw', type: 'string' } satisfies StringOption & {
  mode: 'raw';
};
const mixedBadDefault = Math.random() > 0.5 ? badPlainDefault : arrayDefault;
// @ts-expect-error TS2345: a valid schema branch cannot hide an invalid raw default branch
new Application('mixed-bad-default').option('tags', mixedBadDefault);

const invalidSchemaBranch = {
  default: 5,
  type: 'string',
  validate: z.string(),
} satisfies StringOption;
const validSchemaBranch = {
  default: 5,
  type: 'string',
  validate: z.union([z.string(), z.number()]),
} satisfies StringOption;
const mixedSchemas = Math.random() > 0.5 ? invalidSchemaBranch : validSchemaBranch;
// @ts-expect-error TS2345: schema inputs remain correlated with each branch's default
new Application('mixed-schemas').option('value', mixedSchemas);
