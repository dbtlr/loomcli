import { Application } from '@loom/core';
import type { ActionHandler, StringOption } from '@loom/core';
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

// @ts-expect-error TS2345: a transforming schema default uses its input type
new Application('bad').option('size', { default: 10, type: 'string', validate: number });
// @ts-expect-error TS2345: required values cannot declare defaults
new Application('bad').option('size', { default: '10', required: true, type: 'string' });
// @ts-expect-error TS2345: Boolean options do not accept schemas
new Application('bad').option('flag', { type: 'boolean', validate: z.boolean() });
// @ts-expect-error TS2322: required variadic arguments cannot declare defaults
new Application('bad').argument('files', { default: [], required: true, variadic: true });
// @ts-expect-error TS2345: raw value defaults must be strings
new Application('bad').option('size', { default: 10, type: 'string' });
// @ts-expect-error TS2322: validate takes a Standard Schema object, not a callback
new Application('bad').option('size', { type: 'string', validate: (value: string) => value });

const widened: StringOption = Math.random() > 0.5 ? config : { type: 'string' };
new Application('widened').option('size', widened).action(({ options }) => {
  // @ts-expect-error TS2322: a widened schema configuration cannot promise raw strings
  const unsafe: string | undefined = options.size;
  return unsafe;
});
