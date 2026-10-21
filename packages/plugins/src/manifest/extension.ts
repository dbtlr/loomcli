import { extension } from '@loomcli/core';
import { array, object, optional, pipe, rawTransform, unknown } from 'valibot';

import { packageName } from '../constants.js';
import { line, markdown } from '../lines.js';
import { readFailure } from './failures.js';

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

const commandFacts = object({
  details: optional(markdown),
  examples: optional(array(example)),
  failures: optional(array(declaredFailure)),
});

/**
 * The manifest's collecting extension on Commands, as declarations alone. The author and any
 * plugin supply Markdown, example invocations, and the failures a Command can raise for its manifest
 * entry through it, and every value is kept in collection order. It ships apart from the manifest
 * plugin's entry, so help supplies its values here whether or not the manifest is installed. It
 * applies the pack's shared line and Markdown rules, which help's schema also uses, so every value
 * help supplies validates.
 */
export const manifestCommand = extension(`${packageName}/manifest/command`, {
  collect: true,
  schema: commandFacts,
  target: 'command',
});
