import { extension } from '@loomcli/core';
import type { Extension, StandardSchemaV1 } from '@loomcli/core';
import { array, check, object, optional, pipe, rawTransform, string, unknown } from 'valibot';

import type { CommandExample } from '../command-example.js';
import { packageName } from '../constants.js';
import { exactFacts } from '../exact-facts.js';
import { lineRule, markdownRule } from '../lines.js';
import { readFailure } from './failures.js';

/**
 * One failure a Command can raise, as the author declares it: the failure class, a class that
 * extends `LoomError`, and one line of meaning. `failure` is `unknown` because no type names a
 * failure class, so the schema rejects a value that is not one when the descriptor is called.
 *
 * @public
 */
interface DeclaredFailureInput {
  readonly failure?: unknown;
  readonly meaning: string;
}

/**
 * One declared failure as the manifest reads it: the class's failure code and declared exit code,
 * and the meaning.
 *
 * @public
 * @sealed
 */
interface DeclaredFailure {
  readonly code: string;
  readonly exitCode: number;
  readonly meaning: string;
}

/**
 * The manifest's facts on a Command as the author or a plugin supplies them: Markdown details,
 * example invocations, and the failures it can raise.
 *
 * @public
 */
interface ManifestCommandInput {
  readonly details?: string | undefined;
  readonly examples?: readonly CommandExample[] | undefined;
  readonly failures?: readonly DeclaredFailureInput[] | undefined;
}

/**
 * The manifest's facts on a Command as the schema outputs them, each failure read from its class.
 *
 * @public
 * @sealed
 */
interface ManifestCommandFacts {
  readonly details?: string | undefined;
  readonly examples?: readonly CommandExample[] | undefined;
  readonly failures?: readonly DeclaredFailure[] | undefined;
}

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

const commandFactsSchema = object({
  details: optional(markdown),
  examples: optional(array(example)),
  failures: optional(array(declaredFailure)),
});
const commandFacts = exactFacts<ManifestCommandInput, ManifestCommandFacts>()(commandFactsSchema);

/**
 * The manifest's collecting extension on Commands, as declarations alone. The author and any
 * plugin supply Markdown, example invocations, and the failures a Command can raise for its manifest
 * entry through it, and every value is kept in collection order. It ships apart from the manifest
 * plugin's entry, so help supplies its values here whether or not the manifest is installed. It
 * applies the pack's shared line and Markdown rules, which help's schema also uses, so every value
 * help supplies validates. Its published schema is a Standard Schema over `ManifestCommandInput`
 * and `ManifestCommandFacts`, so an author's type check loads no validation library's declarations.
 *
 * @public
 */
export const manifestCommand: Extension<
  'command',
  StandardSchemaV1<ManifestCommandInput, ManifestCommandFacts>,
  true
> = extension(`${packageName}/manifest/command`, {
  collect: true,
  schema: commandFacts,
  target: 'command',
});

export type { DeclaredFailure, DeclaredFailureInput, ManifestCommandFacts, ManifestCommandInput };
export type { CommandExample } from '../command-example.js';
