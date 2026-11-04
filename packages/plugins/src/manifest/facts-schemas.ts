import { array, check, object, optional, pipe, rawTransform, string, unknown } from 'valibot';

import { lineRule, markdownRule } from '../lines.js';
import { readFailure } from './failures.js';

/**
 * The valibot schema behind the manifest's facts interfaces. The descriptor publishes it as a
 * Standard Schema over those interfaces, and this module stays out of the subpath's entry so the
 * schema is not public.
 */

const line = pipe(string(), check(lineRule.test, lineRule.message));
const markdown = pipe(string(), check(markdownRule.test, markdownRule.message));

/** One example invocation: the tokens after the application name, and an optional note. */
const example = object({ command: line, note: optional(line) });

const failureEntry = object({ failure: optional(unknown()), meaning: line });

/**
 * One failure a Command can raise: its class and one line of meaning. It outputs the failure code
 * and the exit code the class declares, and the meaning, as plain data. A key the schema does not
 * name, such as the retired hand-written `name`, is dropped. The class is read after the entry, and
 * an entry with no `failure` key reads as a value that is not a failure class.
 */
const declaredFailure = pipe(
  failureEntry,
  rawTransform(({ addIssue, dataset, NEVER }) => {
    const read = readFailure(dataset.value.failure);
    if ('issue' in read) {
      addIssue({ message: read.issue });
      return NEVER;
    }
    return { code: read.code, exitCode: read.exitCode, meaning: dataset.value.meaning };
  }),
);

/** @internal The test reads the schema; the declaration output omits it. */
export const commandFactsSchema = object({
  details: optional(markdown),
  examples: optional(array(example)),
  failures: optional(array(declaredFailure)),
});
