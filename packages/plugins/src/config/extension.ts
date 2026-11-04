import { extension } from '@loomcli/core';
import type { Extension, StandardSchemaV1 } from '@loomcli/core';
import { object, pipe, regex, string } from 'valibot';

import { packageName } from '../constants.js';
import { exactFacts } from '../exact-facts.js';

/**
 * The configuration plugin's binding on an option: the dotted path of object keys it reads in the
 * configuration file. Each segment is nonempty, with no escaping and no array indexing, so a key
 * that holds a dot is not reachable.
 *
 * @public
 */
interface ConfigInputFacts {
  readonly path: string;
}

/**
 * A dotted path of object keys, each segment nonempty. There is no escaping and no array indexing,
 * so a key that holds a dot is not reachable.
 */
const configPath = pipe(
  string(),
  regex(/^[^.]+(?:\.[^.]+)*$/u, 'Supply a dotted path of nonempty keys.'),
);

const inputFactsSchema = object({
  path: configPath,
});
const inputFacts = exactFacts<ConfigInputFacts>()(inputFactsSchema);

/**
 * The configuration plugin's binding: the dotted path an option reads in each configuration file.
 * A local option, a global option, and another plugin's option may carry it, and an option that
 * carries it is configuration-bound, so core asks the plugin about it when argv and the
 * environment leave it unfilled. Its published schema is a Standard Schema over
 * `ConfigInputFacts`, so an author's type check loads no validation library's declarations.
 *
 * @public
 */
export const configInput: Extension<
  'option',
  StandardSchemaV1<ConfigInputFacts, ConfigInputFacts>
> = extension(`${packageName}/config/input`, {
  schema: inputFacts,
  target: 'option',
});

export type { ConfigInputFacts };
