import { boolean, check, literal, never, object, optional, pipe, string, union } from 'valibot';

import { proseRule } from '../lines.js';

/**
 * The valibot schemas behind the MCP facts interfaces. The descriptors publish them as Standard
 * Schemas over those interfaces, and this module stays out of the subpath's entry so the schemas
 * are not public.
 */

const annotations = object({
  destructive: optional(boolean()),
  idempotent: optional(boolean()),
  openWorld: optional(boolean()),
  readOnly: optional(boolean()),
});

const prose = pipe(string(), check(proseRule.test, proseRule.message));

/** The value that describes an option, which never also excludes it. */
const described = object({ description: string(), exclude: optional(never()) });

/** The value that excludes an option, which never also describes it. */
const excluding = object({ description: optional(never()), exclude: literal(true) });

/** @internal The test reads the schema; the declaration output omits it. */
export const commandFactsSchema = object({
  annotations: optional(annotations),
  description: optional(prose),
});

/** @internal The test reads the schema; the declaration output omits it. */
export const inputFactsSchema = union([described, excluding]);

/** @internal The test reads the schema; the declaration output omits it. */
export const argumentFactsSchema = object({
  description: string(),
});
