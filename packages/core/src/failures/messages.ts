/*
 * The operator sentences of core's failure classes, under ADR-0164, with the quoting every sentence
 * of core repeats a value through. `tests/message-voice.test.ts` holds this module to the failure
 * message voice.
 */
import { valueCode } from '../diagnostics/diagnostic-text.js';
import { escapeControlCharacters } from '../support/controls.js';

/** Escapes a string, and prints any other value as the code a finding prints for it. */
function quoted(value: unknown): string {
  return typeof value === 'string' ? `"${escapeControlCharacters(value)}"` : valueCode(value);
}

function sentenceStart(text: string): string {
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

function commandSubject(name: string | null): string {
  return name === null ? 'the root Command' : `Command ${quoted(name)}`;
}

function routedSubject(command: readonly string[]): string {
  const name = command.at(-1);
  return name === undefined ? 'the root Command' : commandSubject(name);
}

function commandSentence(name: string | null): string {
  return sentenceStart(commandSubject(name));
}

function routedSentence(command: readonly string[]): string {
  return sentenceStart(routedSubject(command));
}

/** Names a list joins, each escaped, separated by `separator`. */
function escapedList(names: readonly string[], separator: string): string {
  return names.map((name) => escapeControlCharacters(name)).join(separator);
}

function offering(candidates: readonly string[], kind: 'command' | 'subcommand'): string {
  return candidates.length === 0
    ? ` Supply the name of a declared ${kind === 'command' ? 'command' : 'subcommand'}.`
    : ` Use one of: ${escapedList(candidates, ', ')}.`;
}

function unknownCommand(token: string, candidates: readonly string[]): string {
  return `Unknown command ${quoted(token)}.${offering(candidates, 'command')}`;
}

function missingSubcommand(
  command: readonly string[],
  candidates: readonly string[],
  argument: string | undefined,
): string {
  const sentence =
    command.length === 0
      ? `A command is required.${offering(candidates, 'command')}`
      : `${routedSentence(command)} requires a subcommand.${offering(candidates, 'subcommand')}`;
  return argument === undefined ? sentence : passAsArgument(sentence, argument);
}

function passAsArgument(sentence: string, argument: string): string {
  return [sentence, `To pass ${quoted(argument)} as an argument, write -- before it.`].join(' ');
}

function unexpectedArguments(command: readonly string[], accepted: number): string {
  return accepted === 0
    ? `${routedSentence(command)} accepts no arguments. Remove the supplied values.`
    : `${routedSentence(command)} accepts ${accepted} ${accepted === 1 ? 'argument' : 'arguments'}. Remove the extra values.`;
}

function unknownOption(spelling: string): string {
  return `Unknown option ${quoted(spelling)}. Supply a declared option; prefix a hyphenated path with "./".`;
}

/** The unknown option of an invocation by name, which asks for a declared name, because the caller typed no spelling. */
function unknownOptionName(name: string): string {
  return `Unknown option ${quoted(name)}. Supply the name of a declared option.`;
}

/** The unknown option word on a Command whose bare words fill arguments, which offers the delimiter as the way to pass the word as an argument. */
function unknownOptionBeforeArguments(spelling: string): string {
  return `Unknown option ${quoted(spelling)}. Supply a declared option, or pass it as an argument after "--".`;
}

function undeclaredArgument(command: readonly string[], name: string): string {
  return `${routedSentence(command)} declares no argument ${quoted(name)}. Supply the name of a declared argument.`;
}

function declaredNoPassthrough(command: readonly string[]): string {
  return `${routedSentence(command)} declares no passthrough. Remove passthrough from the values.`;
}

function values(count: number): string {
  return `${String(count)} values`;
}

function missingValue(spelling: string): string {
  return `Option ${quoted(spelling)} requires a value. Supply a value after ${quoted(spelling)}.`;
}

/** The sentence of an option that takes a value whose next word was an option word or the bare `--`, so the sentence names the attached form too. */
function missingAttachedValue(spelling: string): string {
  return `Option ${quoted(spelling)} requires a value. Supply a value after ${quoted(spelling)}, or attach one that starts with a hyphen as ${quoted(`${spelling}=<value>`)}.`;
}

function missingArityValues(spelling: string, arity: number, received: number): string {
  return `Option ${quoted(spelling)} requires ${values(arity)} and received ${String(received)}. Supply ${values(arity)} after ${quoted(spelling)}.`;
}

function missingArityRefused(spelling: string, arity: number, refused: string): string {
  return `Option ${quoted(spelling)} requires ${values(arity)}, and ${quoted(refused)} reads as an option. Supply ${values(arity)} after ${quoted(spelling)}; a value that reads as an option cannot be one of them.`;
}

function separateValues(spelling: string): string {
  return `Option ${quoted(spelling)} takes its values as separate words. Supply each one after ${quoted(spelling)} as its own word.`;
}

function countedValue(spelling: string): string {
  return `Counted option ${quoted(spelling)} does not accept a value. Repeat ${quoted(spelling)} to raise its count.`;
}

function booleanValue(spelling: string): string {
  return `Boolean option ${quoted(spelling)} does not accept a value. Supply the flag alone.`;
}

function repeatedOption(spelling: string): string {
  return `Option ${quoted(spelling)} can be supplied only once. Remove the repeated option.`;
}

function misplacedOption(spelling: string, commands: readonly (readonly string[])[]): string {
  const names = commands.map((path) => path.join(' '));
  const [only] = names;
  return names.length === 1 && only !== undefined
    ? `Option ${quoted(spelling)} belongs to command ${quoted(only)}. Supply it after ${quoted(only)}.`
    : `Option ${quoted(spelling)} belongs to commands ${escapedList(names, ', ')}. Supply it after the command name.`;
}

const workingDirectoryUnreadable =
  'The current working directory cannot be read. Change to a directory that exists and run the command again.';

const genericDefect = 'Something went wrong.';

export {
  booleanValue,
  commandSentence,
  commandSubject,
  countedValue,
  declaredNoPassthrough,
  genericDefect,
  misplacedOption,
  missingArityRefused,
  missingArityValues,
  missingAttachedValue,
  missingSubcommand,
  missingValue,
  quoted,
  repeatedOption,
  routedSentence,
  routedSubject,
  separateValues,
  undeclaredArgument,
  unexpectedArguments,
  unknownCommand,
  unknownOption,
  unknownOptionBeforeArguments,
  unknownOptionName,
  workingDirectoryUnreadable,
};
