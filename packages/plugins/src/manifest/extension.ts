import { extension } from '@loomcli/core';
import { z } from 'zod';

import Package from '../../package.json' with { type: 'json' };
import { line, prose } from '../lines.js';
import { failure, failureName } from './failures.js';

/** One example invocation: the tokens after the application name, and an optional note. */
const example = z.object({ command: line, note: line.optional() });

/**
 * One failure a Command can raise: its class, one line of meaning, and a kebab-case name. It
 * outputs the name, the code the class declares, and the meaning, as plain data.
 */
const declaredFailure = z
  .object({ failure, meaning: line, name: failureName })
  .transform((entry) => ({ name: entry.name, exitCode: entry.failure, meaning: entry.meaning }));

/**
 * The manifest's collecting extension on Commands, as declarations alone. The author and any
 * plugin supply prose, example invocations, and the failures a Command can raise for its manifest
 * entry through it, and every value is kept in collection order. It ships apart from the manifest
 * plugin's entry, so help supplies its values here whether or not the manifest is installed. It
 * applies the pack's shared line and prose rules, which help's schema also uses, so every value
 * help supplies validates.
 */
export const manifestCommand = extension(`${Package.name}/manifest/command`, {
  collect: true,
  schema: z.object({
    details: prose.optional(),
    examples: z.array(example).optional(),
    failures: z.array(declaredFailure).optional(),
  }),
  target: 'command',
});
