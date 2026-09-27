import { extension } from '@loomcli/core';
import { z } from 'zod';

import Package from '../../package.json' with { type: 'json' };

/**
 * A dotted path of object keys. Each segment is nonempty and holds no control character and no
 * line separator, U+2028 or U+2029. There is no escaping and no array indexing, so a key that
 * holds a dot is not reachable.
 */
const configPath = z
  .string()
  .regex(
    /^[^.\p{Cc}\p{Zl}\p{Zp}]+(?:\.[^.\p{Cc}\p{Zl}\p{Zp}]+)*$/u,
    'Supply a dotted path of nonempty keys with no control character.',
  );

/**
 * The configuration plugin's binding: the dotted path an option reads in each configuration file.
 * A local option, a global option, and another plugin's option may carry it, and an option that
 * carries it is configuration-bound, so core asks the plugin about it when argv and the
 * environment leave it unfilled.
 */
export const configInput = extension(`${Package.name}/config/input`, {
  schema: z.object({ path: configPath }),
  target: 'option',
});
