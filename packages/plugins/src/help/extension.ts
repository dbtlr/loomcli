import { extension } from '@loomcli/core';
import { array, literal, object, optional, pipe, regex, strictTuple, string, union } from 'valibot';

import { packageName } from '../constants.js';
import { line, markdown } from '../lines.js';

/**
 * The facts a declaration carries for the help page, as declarations alone. A projection that
 * wants help's Details imports this module and never the help middleware, and an application that
 * installs no help plugin still compiles against it. The line and Markdown rules are the manifest's
 * too, so every value help supplies to the manifest validates there.
 */

const example = object({ command: line, note: optional(line) });
const sectionPath = union([strictTuple([line]), strictTuple([line, line])]);
const sectionPaths = array(sectionPath);
const word = pipe(string(), regex(/^[^\s\u0085]+$/u, 'Supply one word with no whitespace.'));

const commandFacts = object({
  commandSections: optional(sectionPaths),
  details: optional(markdown),
  examples: optional(array(example)),
  optionSections: optional(sectionPaths),
  section: optional(sectionPath),
});

const inputFacts = object({
  accepts: optional(line),
  hideBindings: optional(literal(true)),
  placeholder: optional(word),
  section: optional(sectionPath),
});

export const helpCommand = extension(`${packageName}/help/command`, {
  schema: commandFacts,
  target: 'command',
});

export const helpInput = extension(`${packageName}/help/input`, {
  schema: inputFacts,
  target: 'option',
});

/**
 * Help's one fact on an argument: the sentence its row prints as the values it accepts, in place of
 * any list help would derive from the schema. An argument's placeholder is its declared name.
 */
export const helpArgument = extension(`${packageName}/help/argument`, {
  schema: object({ accepts: optional(line) }),
  target: 'argument',
});
