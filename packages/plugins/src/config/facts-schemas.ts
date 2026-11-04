import { object, pipe, regex, string } from 'valibot';

/**
 * The valibot schema behind the configuration binding's facts interface. The descriptor publishes
 * it as a Standard Schema over that interface, and this module stays out of the subpath's entry so
 * the schema is not public.
 */

/**
 * A dotted path of object keys, each segment nonempty. There is no escaping and no array indexing,
 * so a key that holds a dot is not reachable.
 */
const configPath = pipe(
  string(),
  regex(/^[^.]+(?:\.[^.]+)*$/u, 'Supply a dotted path of nonempty keys.'),
);

/** @internal The test reads the schema; the declaration output omits it. */
export const inputFactsSchema = object({
  path: configPath,
});
