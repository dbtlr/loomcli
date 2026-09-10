import { extension } from '@loomcli/core';
import { z } from 'zod';

import Package from '../../package.json' with { type: 'json' };

/**
 * The two facts a declaration carries for the help page, as declarations alone. A projection that
 * wants help's prose imports this module and never the help middleware, and an application that
 * installs no help plugin still compiles against it.
 */
const terminator = /[\n\v\f\r\u0085\u2028\u2029]/u;
const line = z.string().refine((value) => /\S/u.test(value) && !terminator.test(value), {
  message: 'Supply one line that holds a character other than whitespace.',
});
const prose = z
  .string()
  .refine(
    (value) => value.split(/\r\n|[\n\v\f\r\u0085\u2028\u2029]/u).every((each) => /\S/u.test(each)),
    { message: 'Supply prose whose every line holds a character other than whitespace.' },
  );

const example = z.object({ command: line, note: line.optional() });

export const helpCommand = extension(`${Package.name}/help/command`, {
  schema: z.object({ details: prose.optional(), examples: z.array(example).optional() }),
  target: 'command',
});

export const helpInput = extension(`${Package.name}/help/input`, {
  schema: z.object({
    placeholder: z
      .string()
      .regex(/^[^\s\u0085]+$/u, 'Supply one word with no whitespace.')
      .optional(),
  }),
  target: 'option',
});
