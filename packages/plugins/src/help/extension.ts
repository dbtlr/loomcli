import { extension } from '@loomcli/core';
import type { Extension, StandardSchemaV1 } from '@loomcli/core';
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

import type { CommandExample } from '../command-example.js';
import { packageName } from '../constants.js';
import { exactFacts } from '../exact-facts.js';
import { lineRule, markdownRule } from '../lines.js';

/**
 * The facts a declaration carries for the help page, as declarations alone. A projection that
 * wants help's Details imports this module and never the help middleware, and an application that
 * installs no help plugin still compiles against it. The line and Markdown rules are the manifest's
 * too, so every value help supplies to the manifest validates there. Each descriptor's published
 * schema is a Standard Schema over the interface below it, so an author's type check loads no
 * validation library's declarations.
 */

/**
 * A help section's place: one heading, or a heading and its subsection's. Each heading is one line.
 *
 * @public
 */
type HelpSectionPath = readonly [string] | readonly [string, string];

/**
 * Help's facts on a Command: its Markdown details, its Markdown epilog, its examples, the section it
 * sits in on its parent's page, and the order of the sections on its own page. Every page on or under
 * the Command ends with its epilog.
 *
 * @public
 */
interface HelpCommandFacts {
  readonly commandSections?: readonly HelpSectionPath[] | undefined;
  readonly details?: string | undefined;
  readonly epilog?: string | undefined;
  readonly examples?: readonly CommandExample[] | undefined;
  readonly optionSections?: readonly HelpSectionPath[] | undefined;
  readonly section?: HelpSectionPath | undefined;
}

/**
 * Help's facts on an option: the line it prints as the accepted values, whether it hides the
 * option's bindings, the word for its value, and the section it sits in.
 *
 * @public
 */
interface HelpInputFacts {
  readonly accepts?: string | undefined;
  readonly hideBindings?: true | undefined;
  readonly placeholder?: string | undefined;
  readonly section?: HelpSectionPath | undefined;
}

/**
 * Help's one fact on an argument: the line it prints as the accepted values.
 *
 * @public
 */
interface HelpArgumentFacts {
  readonly accepts?: string | undefined;
}

const line = pipe(string(), check(lineRule.test, lineRule.message));
const markdown = pipe(string(), check(markdownRule.test, markdownRule.message));
const example = object({ command: line, note: optional(line) });
const sectionPath = union([strictTuple([line]), strictTuple([line, line])]);
const sectionPaths = array(sectionPath);
const word = pipe(string(), regex(/^[^\s\u0085]+$/u, 'Supply one word with no whitespace.'));

const commandFactsSchema = object({
  commandSections: optional(sectionPaths),
  details: optional(markdown),
  epilog: optional(markdown),
  examples: optional(array(example)),
  optionSections: optional(sectionPaths),
  section: optional(sectionPath),
});
const commandFacts = exactFacts<HelpCommandFacts>()(commandFactsSchema);

const inputFactsSchema = object({
  accepts: optional(line),
  hideBindings: optional(literal(true)),
  placeholder: optional(word),
  section: optional(sectionPath),
});
const inputFacts = exactFacts<HelpInputFacts>()(inputFactsSchema);

const argumentFactsSchema = object({
  accepts: optional(line),
});
const argumentFacts = exactFacts<HelpArgumentFacts>()(argumentFactsSchema);

/**
 * Help's facts on a Command or the Application: details, an epilog, examples, its section, and the
 * order of the sections on its own page.
 *
 * @public
 */
export const helpCommand: Extension<
  'command',
  StandardSchemaV1<HelpCommandFacts, HelpCommandFacts>
> = extension(`${packageName}/help/command`, {
  schema: commandFacts,
  target: 'command',
});

/**
 * Help's facts on an option: its accepted values, its placeholder, its section, and whether its
 * bindings are hidden.
 *
 * @public
 */
export const helpInput: Extension<
  'option',
  StandardSchemaV1<HelpInputFacts, HelpInputFacts>
> = extension(`${packageName}/help/input`, {
  schema: inputFacts,
  target: 'option',
});

/**
 * Help's one fact on an argument: the sentence its row prints as the values it accepts, in place of
 * any list help would derive from the schema. An argument's placeholder is its declared name.
 *
 * @public
 */
export const helpArgument: Extension<
  'argument',
  StandardSchemaV1<HelpArgumentFacts, HelpArgumentFacts>
> = extension(`${packageName}/help/argument`, {
  schema: argumentFacts,
  target: 'argument',
});

export type { HelpArgumentFacts, HelpCommandFacts, HelpInputFacts, HelpSectionPath };
export type { CommandExample } from '../command-example.js';
