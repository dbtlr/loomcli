import {
  array,
  check,
  literal,
  object,
  optional,
  pipe,
  regex,
  strictTuple,
  string,
  union,
} from 'valibot';

import { lineRule, markdownRule } from '../lines.js';

/**
 * The valibot schemas behind help's facts interfaces. The descriptors publish them as Standard
 * Schemas over those interfaces, and this module stays out of the subpath's entry so the schemas
 * are not public.
 */

const line = pipe(string(), check(lineRule.test, lineRule.message));
const markdown = pipe(string(), check(markdownRule.test, markdownRule.message));
const example = object({ command: line, note: optional(line) });
const sectionPath = union([strictTuple([line]), strictTuple([line, line])]);
const sectionPaths = array(sectionPath);
const word = pipe(string(), regex(/^[^\s\u0085]+$/u, 'Supply one word with no whitespace.'));

/** @internal The test reads the schema; the declaration output omits it. */
export const commandFactsSchema = object({
  commandSections: optional(sectionPaths),
  details: optional(markdown),
  examples: optional(array(example)),
  optionSections: optional(sectionPaths),
  section: optional(sectionPath),
});

/** @internal The test reads the schema; the declaration output omits it. */
export const inputFactsSchema = object({
  accepts: optional(line),
  hideBindings: optional(literal(true)),
  placeholder: optional(word),
  section: optional(sectionPath),
});

/** @internal The test reads the schema; the declaration output omits it. */
export const argumentFactsSchema = object({
  accepts: optional(line),
});
