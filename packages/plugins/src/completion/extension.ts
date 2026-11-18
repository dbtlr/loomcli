import { extension } from '@loomcli/core';
import type { Extension, StandardSchemaV1 } from '@loomcli/core';
import {
  array,
  literal,
  minLength,
  never,
  object,
  optional,
  pipe,
  regex,
  string,
  union,
} from 'valibot';

import { packageName } from '../constants.js';
import { exactFacts } from '../exact-facts.js';

/**
 * The completion plugin's facts, as declarations alone. An option or an argument opts in to one
 * static value hint with a `completionInput` or `completionArgument` value, so a Command library
 * hints its inputs without importing the plugin's entry. The hints name no shell and no protocol
 * number. Each descriptor's published schema is a Standard Schema over the interface it names, so
 * an author's type check loads no validation library's declarations.
 */

/**
 * The hint for an argument's value, exactly one of six, because an input completes one way. Each
 * member names its own key and holds every other hint's key absent, so a value with two hints is a
 * type error, and a value that bypasses the types is rejected as an invalid extension value. Only
 * an argument takes `commands`; an option's hint is a {@link CompletionInputFacts}.
 *
 * @public
 */
type CompletionValueFacts =
  | {
      /** Offer file names, directories included: the shell's own file completion. */
      readonly files: true;
      readonly extensions?: undefined;
      readonly directories?: undefined;
      readonly none?: undefined;
      readonly commands?: undefined;
      readonly values?: undefined;
    }
  | {
      /** Offer the directories, and the files whose name ends in one of these extensions. */
      readonly extensions: readonly string[];
      readonly files?: undefined;
      readonly directories?: undefined;
      readonly none?: undefined;
      readonly commands?: undefined;
      readonly values?: undefined;
    }
  | {
      /** Offer the directories only. */
      readonly directories: true;
      readonly files?: undefined;
      readonly extensions?: undefined;
      readonly none?: undefined;
      readonly commands?: undefined;
      readonly values?: undefined;
    }
  | {
      /** Offer nothing, and no file name. */
      readonly none: true;
      readonly files?: undefined;
      readonly extensions?: undefined;
      readonly directories?: undefined;
      readonly commands?: undefined;
      readonly values?: undefined;
    }
  | {
      /** Offer the Commands the earlier words of the input have reached, as a path from the root. */
      readonly commands: true;
      readonly files?: undefined;
      readonly extensions?: undefined;
      readonly directories?: undefined;
      readonly none?: undefined;
      readonly values?: undefined;
    }
  | {
      /** Offer the values the plugin's settings' completer of this name returns at Tab time. */
      readonly values: string;
      readonly files?: undefined;
      readonly extensions?: undefined;
      readonly directories?: undefined;
      readonly none?: undefined;
      readonly commands?: undefined;
    };

/**
 * The hint for an option's value: every hint an argument takes except `commands`, because only an
 * argument's earlier words name a path of Commands.
 *
 * @public
 */
type CompletionInputFacts = Exclude<CompletionValueFacts, { readonly commands: true }>;

const absent = optional(never());

/**
 * One extension: the name without its dot, such as `json` or `tar.gz`. It starts with a letter or a
 * digit and holds only letters, digits, `.`, `_`, `+`, and `-`, so a script compares it as text and
 * no shell reads a glob, a space, or a control character in it.
 */
const extensionName = pipe(string(), regex(/^[\dA-Za-z][\w.+-]*$/u));

/** An `extensions` list names at least one extension. */
const leastOne = 1;
const extensionList = pipe(array(extensionName), minLength(leastOne));

/** A completer's name: any nonempty text, since the settings' record keys it. */
const completerName = pipe(string(), minLength(leastOne));

const fileHints = [
  object({
    commands: absent,
    directories: absent,
    extensions: absent,
    files: literal(true),
    none: absent,
    values: absent,
  }),
  object({
    commands: absent,
    directories: absent,
    extensions: extensionList,
    files: absent,
    none: absent,
    values: absent,
  }),
  object({
    commands: absent,
    directories: literal(true),
    extensions: absent,
    files: absent,
    none: absent,
    values: absent,
  }),
  object({
    commands: absent,
    directories: absent,
    extensions: absent,
    files: absent,
    none: literal(true),
    values: absent,
  }),
  object({
    commands: absent,
    directories: absent,
    extensions: absent,
    files: absent,
    none: absent,
    values: completerName,
  }),
] as const;
const commandsHint = object({
  commands: literal(true),
  directories: absent,
  extensions: absent,
  files: absent,
  none: absent,
  values: absent,
});
const inputFacts = exactFacts<CompletionInputFacts>()(union(fileHints));
const argumentFacts = exactFacts<CompletionValueFacts>()(union([...fileHints, commandsHint]));

/**
 * An option's value hint for shell completion: file names, the files of some extensions, the
 * directories, or nothing. An input whose schema names a closed set offers that set, and its hint
 * is not read for the answer; a completer name it holds is still checked at graph build.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { completionInput } from '@loomcli/plugins/completion/extension';
 *
 * export const get = new Command('get').option('file', {
 *   extensions: [completionInput({ extensions: ['json', 'yaml'] })],
 *   type: 'string',
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/completion.md
 *
 * @public
 */
export const completionInput: Extension<
  'option',
  StandardSchemaV1<CompletionInputFacts, CompletionInputFacts>
> = extension(`${packageName}/completion/input`, {
  schema: inputFacts,
  target: 'option',
});

/**
 * An argument's value hint for shell completion: an option's hints, or the Commands the earlier
 * words of the argument have reached, as a path from the root.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { completionArgument } from '@loomcli/plugins/completion/extension';
 *
 * export const enter = new Command('enter').argument('folder', {
 *   extensions: [completionArgument({ directories: true })],
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/completion.md
 *
 * @public
 */
export const completionArgument: Extension<
  'argument',
  StandardSchemaV1<CompletionValueFacts, CompletionValueFacts>
> = extension(`${packageName}/completion/argument`, {
  schema: argumentFacts,
  target: 'argument',
});

export type { CompletionInputFacts, CompletionValueFacts };
