import { extension } from '@loomcli/core';
import { z } from 'zod';

import Package from '../../package.json' with { type: 'json' };
import { line, prose } from '../lines.js';

/** One example invocation: the tokens after the application name, and an optional note. */
const example = z.object({ command: line, note: line.optional() });

/**
 * The manifest's collecting extension on Commands, as declarations alone. The author and any
 * plugin supply prose and example invocations for a Command's manifest entry through it, and every
 * value is kept in collection order. It ships apart from the manifest plugin's entry, so help
 * supplies its values here whether or not the manifest is installed. The line and prose rules are
 * help's own, so every value help supplies validates.
 */
export const manifestCommand = extension(`${Package.name}/manifest/command`, {
  collect: true,
  schema: z.object({ details: prose.optional(), examples: z.array(example).optional() }),
  target: 'command',
});
