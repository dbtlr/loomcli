import { extension } from '@loomcli/core';
import { object, pipe, regex, string } from 'valibot';

import { packageName } from '../constants.js';

/**
 * A dotted path of object keys, each segment nonempty. There is no escaping and no array indexing,
 * so a key that holds a dot is not reachable.
 */
const configPath = pipe(
  string(),
  regex(/^[^.]+(?:\.[^.]+)*$/u, 'Supply a dotted path of nonempty keys.'),
);

/**
 * The configuration plugin's binding: the dotted path an option reads in each configuration file.
 * A local option, a global option, and another plugin's option may carry it, and an option that
 * carries it is configuration-bound, so core asks the plugin about it when argv and the
 * environment leave it unfilled.
 */
export const configInput = extension(`${packageName}/config/input`, {
  schema: object({ path: configPath }),
  target: 'option',
});
