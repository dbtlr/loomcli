/*
 * The operator sentences of the help plugin, under ADR-0164: the hint under a usage error, and the
 * fixed labels of a help page, which help says through `ViewContext.localize` under ADR-0200. The
 * man page and a skill's command reference print the same labels in English from their own code.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';
import type { ContextualStyle } from '@loomcli/core';

const shownCommand = (words: readonly string[]): string =>
  words.map(escapeControlCharacters).join(' ');

function usageHint(command: readonly string[]): string {
  return `Run "${shownCommand([...command, '--help'])}" to see the usage.`;
}

/** The accepted-values sentence help derives from a closed set, its values already listed and escaped. */
function acceptedValues(values: string): string {
  return `One of: ${values}.`;
}

/** The heading over a page's usage forms. */
const usageHeading = 'USAGE';

/** The heading over a page's child Commands that no authored section holds. */
const commandsHeading = 'COMMANDS';

/** The heading over a page's arguments. */
const argumentsHeading = 'ARGUMENTS';

/** The heading over a page's options that no authored section holds. */
const optionsHeading = 'OPTIONS';

/** The heading over a page's global options that no authored section holds. */
const globalOptionsHeading = 'GLOBAL OPTIONS';

/** The heading over a page's examples. */
const examplesHeading = 'EXAMPLES';

/** The heading over a page's standalone stdin. */
const inputHeading = 'INPUT';

/** The label of the line under a masthead that names a Command's one visible alias. */
const aliasLabel = 'Alias: ';

/** The label of the line under a masthead that names a Command's visible aliases. */
const aliasesLabel = 'Aliases: ';

/** The label of the line under a masthead that holds a deprecated Command's migration message. */
const deprecatedLabel = 'Deprecated: ';

/** The label of the line under a masthead that says a Command needs a terminal. */
const needsTerminalLabel = 'Needs a terminal: ';

/** The text of the line under a masthead that says a Command needs a terminal. */
const needsTerminalText = 'stdin and stderr, outside CI.';

/** The right cell of the `--` row, which tells an operator how to pass a child's name. */
const escapeDescription = 'Read every later word as an argument, even a command name.';

/** The sentence of the INPUT block for a Command whose stdin is required. */
const stdinRequired = 'Required. Reads piped or redirected stdin. Terminal input is not accepted.';

/** The sentence of the INPUT block for a Command whose stdin is optional. */
const stdinOptional = 'Optional. Reads piped or redirected stdin. Terminal input is not accepted.';

/** The example line of the INPUT block, after the Command's routed path, written as a literal. */
function stdinExample(path: string): string {
  return `Example: <producer> | ${path}`;
}

/** A fixed word or phrase of a hint in the dim tone of a help page's labels. */
function dimmed(text: string, style: ContextualStyle): string {
  return style.dim(style.escape(text));
}

/**
 * The closing hint of a page that printed child rows. `command` is the command it names, already
 * styled and kept on one line, which the sentence places and surrounds with its own dim words.
 */
function childHint(command: string, style: ContextualStyle): string {
  return `${dimmed('Run', style)} ${command} ${dimmed('for command details.', style)}`;
}

/**
 * The compact page's pointer to the extended page. `command` is the command it names, already
 * styled and kept on one line.
 */
function extendedHint(command: string, style: ContextualStyle): string {
  return `${dimmed('Run', style)} ${command} ${dimmed('for details and examples.', style)}`;
}

/** The fact of a required option. */
const requiredFact = 'required';

/** The fact of an input required when the run is not interactive. */
const requiredWhenNotInteractiveFact = 'required when not interactive';

/** The fact of an option an operator may supply more than once. */
const repeatableFact = 'repeatable';

/** The fact of a declared default, its value already on one line. */
function defaultFact(value: string): string {
  return `default: ${value}`;
}

/** The fact of an implied value, its value already on one line. */
function impliedFact(value: string): string {
  return `implied: ${value}`;
}

/** The fact of a deprecated member, its migration message already on one line. */
function deprecatedFact(message: string): string {
  return `deprecated: ${message}`;
}

/** The fact of a content input that reads a file path and no stdin. */
const filePathFact = 'file path';

/** The fact of a collected content input that reads files and stdin. */
const filesAndStdinFact = 'files and piped stdin; - places stdin';

/** The fact of a content input that reads one file or stdin. */
const fileOrStdinFact = 'file or piped stdin; - selects stdin';

const singleSource = 1;

/** The fact of a content input's fewest sources. */
function minSourcesFact(count: number): string {
  return `min: ${String(count)} ${count === singleSource ? 'source' : 'sources'}`;
}

/** The fact of a content input's most sources. */
function maxSourcesFact(count: number): string {
  return `max: ${String(count)} ${count === singleSource ? 'source' : 'sources'}`;
}

/** The label of the fact that names a member's one visible alias, before the name. */
const aliasFactLabel = 'alias: ';

/** The label of the fact that names a member's visible aliases, before the names. */
const aliasesFactLabel = 'aliases: ';

/** The label of the fact that names an option's environment variables. */
const envFactLabel = 'env:';

/** The label of the fact that names an option's configuration path. */
const configFactLabel = 'config:';

/** What a multiple option's variable splits into. */
const listNoun = 'a list';

/** What a scalar arity option's variable splits into: exactly its arity of values. */
function valuesNoun(arity: number): string {
  return `${String(arity)} values`;
}

/** The words between a binding fact's names and its delimiter, naming what the variable splits into. */
function separatedBy(noun: string): string {
  return ` as ${noun} separated by `;
}

export {
  acceptedValues,
  aliasesFactLabel,
  aliasesLabel,
  aliasFactLabel,
  aliasLabel,
  argumentsHeading,
  childHint,
  commandsHeading,
  configFactLabel,
  defaultFact,
  deprecatedFact,
  deprecatedLabel,
  envFactLabel,
  escapeDescription,
  examplesHeading,
  extendedHint,
  fileOrStdinFact,
  filePathFact,
  filesAndStdinFact,
  globalOptionsHeading,
  impliedFact,
  inputHeading,
  listNoun,
  maxSourcesFact,
  minSourcesFact,
  needsTerminalLabel,
  needsTerminalText,
  optionsHeading,
  repeatableFact,
  requiredFact,
  requiredWhenNotInteractiveFact,
  separatedBy,
  stdinExample,
  stdinOptional,
  stdinRequired,
  usageHeading,
  usageHint,
  valuesNoun,
};
