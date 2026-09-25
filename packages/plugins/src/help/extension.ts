import { extension } from '@loomcli/core';
import { z } from 'zod';

import Package from '../../package.json' with { type: 'json' };
import { line, prose } from '../lines.js';

/**
 * The facts a declaration carries for the help page, as declarations alone. A projection that
 * wants help's prose imports this module and never the help middleware, and an application that
 * installs no help plugin still compiles against it. The line and prose rules are the manifest's
 * too, so every value help supplies to the manifest validates there.
 */

const example = z.object({ command: line, note: line.optional() });

export const helpCommand = extension(`${Package.name}/help/command`, {
  schema: z.object({ details: prose.optional(), examples: z.array(example).optional() }),
  target: 'command',
});

export const helpInput = extension(`${Package.name}/help/input`, {
  schema: z.object({
    accepts: line.optional(),
    placeholder: z
      .string()
      .regex(/^[^\s\u0085]+$/u, 'Supply one word with no whitespace.')
      .optional(),
  }),
  target: 'option',
});

/**
 * Help's one fact on an argument: the sentence its row prints as the values it accepts, in place of
 * any list help would derive from the schema. An argument's placeholder is its declared name.
 */
export const helpArgument = extension(`${Package.name}/help/argument`, {
  schema: z.object({ accepts: line.optional() }),
  target: 'argument',
});
