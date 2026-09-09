import { Application, Command, GlobalOptions } from '@loomcli/core';
import type { StandardSchemaV1, StringOption } from '@loomcli/core';
import { z } from 'zod';

/** Omission is one of the values this rule answers, so its input type accepts `undefined`. */
const fileOrStdin: StandardSchemaV1<string | undefined, string> = {
  '~standard': {
    validate: (value: unknown) => ({ value: typeof value === 'string' ? value : 'stdin' }),
    vendor: 'type-consumer',
    version: 1,
  },
};

const globals = new GlobalOptions().option('file', {
  short: 'f',
  type: 'string',
  validate: fileOrStdin,
  validateOmitted: true,
});

new Command('read', { globals })
  .argument('path', { validate: fileOrStdin, validateOmitted: true })
  .option('output', { type: 'string', validate: fileOrStdin, validateOmitted: true })
  .action(({ args, options }) => {
    const file: string = options.file;
    const output: string = options.output;
    const path: string = args.path;
    // @ts-expect-error TS2322: The schema answers omission, so the value is never undefined.
    const absent: undefined = options.file;
    return { absent, file, output, path };
  });

/** An extracted configuration keeps the flag exact, as an extracted `multiple: true` does. */
const extracted = {
  type: 'string',
  validate: fileOrStdin,
  validateOmitted: true,
} satisfies StringOption;
new Application('extracted').option('source', extracted).action(({ options }) => {
  const source: string = options.source;
  return source;
});

// @ts-expect-error TS2345: A validateOmitted schema reads the omission, so it accepts undefined.
new Application('bad').option('file', {
  type: 'string',
  validate: z.string(),
  validateOmitted: true,
});
// @ts-expect-error TS2345: A required input rejects validateOmitted.
new Application('bad').option('file', {
  required: true,
  type: 'string',
  validate: fileOrStdin,
  validateOmitted: true,
});
// @ts-expect-error TS2345: A declared default rejects validateOmitted.
new Application('bad').option('file', {
  default: 'doc.json',
  type: 'string',
  validate: fileOrStdin,
  validateOmitted: true,
});
// @ts-expect-error TS2345: A multiple option validates its omission as an empty array.
new Application('bad').option('file', {
  multiple: true,
  type: 'string',
  validate: z.array(z.string()),
  validateOmitted: true,
});
// @ts-expect-error TS2345: A variadic argument validates its omission as an empty array.
new Command('bad').argument('files', {
  validate: z.array(z.string()),
  validateOmitted: true,
  variadic: true,
});
// @ts-expect-error TS2345: A Boolean option declares no validateOmitted.
new Application('bad').option('force', { type: 'boolean', validateOmitted: true });
// @ts-expect-error TS2345: validateOmitted needs a schema to receive the omission.
new Application('bad').option('file', { type: 'string', validateOmitted: true });
