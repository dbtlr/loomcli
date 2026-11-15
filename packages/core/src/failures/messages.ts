/*
 * The operator sentences of core's failure classes and of the failure form, under ADR-0164, with
 * the subjects and the quoting every sentence of core repeats a value through. Each sentence is a
 * function of the values it repeats, or a constant, and the code that raises the failure calls it.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { valueCode } from '../diagnostics/diagnostic-text.js';
import { escapeControlCharacters } from '../support/controls.js';

/**
 * A value a sentence quotes: raw text an operator typed, or a name or identity an author declared.
 * Text is escaped, so a control character or a bidirectional control in it cannot reorder or break
 * the line. A value of any other kind prints as the code a finding prints for it, because a rule
 * that rejects a value that is not a string quotes that value too. The failure's public field
 * keeps the raw value.
 *
 * @example
 * ```ts
 * quoted('--verbos'); // '"--verbos"'
 * ```
 */
function quoted(value: unknown): string {
  return typeof value === 'string' ? `"${escapeControlCharacters(value)}"` : valueCode(value);
}

/**
 * Text placed at the start of a sentence, its first letter uppercased: `the root Command` reads
 * `The root Command`.
 *
 * @example
 * ```ts
 * sentenceStart('the root Command'); // 'The root Command'
 * ```
 */
function sentenceStart(text: string): string {
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

/**
 * How a sentence names one Command: by name, or as the unnamed root.
 *
 * @example
 * ```ts
 * commandSubject('deploy'); // 'Command "deploy"'
 * commandSubject(null); // 'the root Command'
 * ```
 */
function commandSubject(name: string | null): string {
  return name === null ? 'the root Command' : `Command ${quoted(name)}`;
}

/**
 * The routed path names the Command a sentence speaks of; an empty path is the root.
 *
 * @example
 * ```ts
 * routedSubject(['remote', 'add']); // 'Command "add"'
 * ```
 */
function routedSubject(command: readonly string[]): string {
  const name = command.at(-1);
  return name === undefined ? 'the root Command' : commandSubject(name);
}

/**
 * How a sentence that opens with one Command names it.
 *
 * @example
 * ```ts
 * commandSentence(null); // 'The root Command'
 * ```
 */
function commandSentence(name: string | null): string {
  return sentenceStart(commandSubject(name));
}

/**
 * The routed Command at the start of a sentence.
 *
 * @example
 * ```ts
 * routedSentence([]); // 'The root Command'
 * ```
 */
function routedSentence(command: readonly string[]): string {
  return sentenceStart(routedSubject(command));
}

/** Names a list joins, each escaped, separated by `separator`. */
function escapedList(names: readonly string[], separator: string): string {
  return names.map((name) => escapeControlCharacters(name)).join(separator);
}

/**
 * The clause that states a routing fault's fix: the candidates, or, when the Command offers none
 * because every child is hidden or deprecated, the kind of name to supply.
 */
function offering(candidates: readonly string[], kind: 'command' | 'subcommand'): string {
  return candidates.length === 0
    ? ` Supply the name of a declared ${kind === 'command' ? 'command' : 'subcommand'}.`
    : ` Use one of: ${escapedList(candidates, ', ')}.`;
}

/**
 * The sentence of a word routing took for a Command name that no Command answers to.
 *
 * @example
 * ```ts
 * unknownCommand('nope', ['get', 'keys']);
 * // 'Unknown command "nope". Use one of: get, keys.'
 * ```
 */
function unknownCommand(token: string, candidates: readonly string[]): string {
  return `Unknown command ${quoted(token)}.${offering(candidates, 'command')}`;
}

/**
 * The sentence for a group routed without a subcommand. The root has no name to repeat, and the
 * default text already opens with the application name, so the root's sentence names no Command.
 * A word that could also have been the parent's argument ends it with the `--` that passes it.
 *
 * @example
 * ```ts
 * missingSubcommand(['remote'], ['add', 'remove'], undefined);
 * // 'Command "remote" requires a subcommand. Use one of: add, remove.'
 * ```
 */
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

/** A missing-subcommand sentence followed by the `--` that passes the word as an argument. */
function passAsArgument(sentence: string, argument: string): string {
  return [sentence, `To pass ${quoted(argument)} as an argument, write -- before it.`].join(' ');
}

/**
 * The sentence of more arguments than the routed Command declares.
 *
 * @example
 * ```ts
 * unexpectedArguments(['get'], 1); // 'Command "get" accepts 1 argument. Remove the extra values.'
 * ```
 */
function unexpectedArguments(command: readonly string[], accepted: number): string {
  return accepted === 0
    ? `${routedSentence(command)} accepts no arguments. Remove the supplied values.`
    : `${routedSentence(command)} accepts ${accepted} ${accepted === 1 ? 'argument' : 'arguments'}. Remove the extra values.`;
}

/**
 * The sentence of an option word no Command routing reached declares.
 *
 * @example
 * ```ts
 * unknownOption('--verbos');
 * ```
 */
function unknownOption(spelling: string): string {
  return `Unknown option ${quoted(spelling)}. Supply a declared option; prefix a hyphenated path with "./".`;
}

/**
 * The unknown option of an invocation by name, which asks for a declared name, because the caller
 * typed no spelling.
 *
 * @example
 * ```ts
 * unknownOptionName('verbos'); // 'Unknown option "verbos". Supply the name of a declared option.'
 * ```
 */
function unknownOptionName(name: string): string {
  return `Unknown option ${quoted(name)}. Supply the name of a declared option.`;
}

/**
 * The unknown option word on a Command whose bare words fill arguments, which offers the delimiter
 * as the way to pass the word as an argument.
 *
 * @example
 * ```ts
 * unknownOptionBeforeArguments('-draft.txt');
 * ```
 */
function unknownOptionBeforeArguments(spelling: string): string {
  return `Unknown option ${quoted(spelling)}. Supply a declared option, or pass it as an argument after "--".`;
}

/**
 * The sentence of an `args` key the routed Command does not declare, in an invocation by name.
 *
 * @example
 * ```ts
 * undeclaredArgument(['get'], 'path');
 * // 'Command "get" declares no argument "path". Supply the name of a declared argument.'
 * ```
 */
function undeclaredArgument(command: readonly string[], name: string): string {
  return `${routedSentence(command)} declares no argument ${quoted(name)}. Supply the name of a declared argument.`;
}

/**
 * The sentence of a named tail on a Command that declares no passthrough mode.
 *
 * @example
 * ```ts
 * declaredNoPassthrough(['get']);
 * // 'Command "get" declares no passthrough. Remove passthrough from the values.'
 * ```
 */
function declaredNoPassthrough(command: readonly string[]): string {
  return `${routedSentence(command)} declares no passthrough. Remove passthrough from the values.`;
}

/** An arity option's count of values, as its sentences name it. */
function values(count: number): string {
  return `${String(count)} values`;
}

/**
 * The sentence of an option that takes a value supplied without one, where the words ran out.
 *
 * @example
 * ```ts
 * missingValue('--file'); // 'Option "--file" requires a value. Supply a value after "--file".'
 * ```
 */
function missingValue(spelling: string): string {
  return `Option ${quoted(spelling)} requires a value. Supply a value after ${quoted(spelling)}.`;
}

/**
 * The sentence of an option that takes a value whose next word was an option word or the bare
 * `--`, so the sentence names the attached form too.
 *
 * @example
 * ```ts
 * missingAttachedValue('--file');
 * ```
 */
function missingAttachedValue(spelling: string): string {
  return `Option ${quoted(spelling)} requires a value. Supply a value after ${quoted(spelling)}, or attach one that starts with a hyphen as ${quoted(`${spelling}=<value>`)}.`;
}

/**
 * The sentence of an arity option's occurrence that ran out of words before its count.
 *
 * @example
 * ```ts
 * missingArityValues('--point', 2, 1);
 * // 'Option "--point" requires 2 values and received 1. Supply 2 values after "--point".'
 * ```
 */
function missingArityValues(spelling: string, arity: number, received: number): string {
  return `Option ${quoted(spelling)} requires ${values(arity)} and received ${String(received)}. Supply ${values(arity)} after ${quoted(spelling)}.`;
}

/**
 * The sentence of an arity option's occurrence an option word ended before its count.
 *
 * @example
 * ```ts
 * missingArityRefused('--point', 2, '--x');
 * ```
 */
function missingArityRefused(spelling: string, arity: number, refused: string): string {
  return `Option ${quoted(spelling)} requires ${values(arity)}, and ${quoted(refused)} reads as an option. Supply ${values(arity)} after ${quoted(spelling)}; a value that reads as an option cannot be one of them.`;
}

/**
 * The sentence of a value attached to an arity option, which takes its values as separate words.
 *
 * @example
 * ```ts
 * separateValues('--point');
 * ```
 */
function separateValues(spelling: string): string {
  return `Option ${quoted(spelling)} takes its values as separate words. Supply each one after ${quoted(spelling)} as its own word.`;
}

/**
 * The sentence of a value attached to a counted option.
 *
 * @example
 * ```ts
 * countedValue('-v'); // 'Counted option "-v" does not accept a value. Repeat "-v" to raise its count.'
 * ```
 */
function countedValue(spelling: string): string {
  return `Counted option ${quoted(spelling)} does not accept a value. Repeat ${quoted(spelling)} to raise its count.`;
}

/**
 * The sentence of a value attached to a Boolean option.
 *
 * @example
 * ```ts
 * booleanValue('--force'); // 'Boolean option "--force" does not accept a value. Supply the flag alone.'
 * ```
 */
function booleanValue(spelling: string): string {
  return `Boolean option ${quoted(spelling)} does not accept a value. Supply the flag alone.`;
}

/**
 * The sentence of an option that can be supplied only once, supplied again.
 *
 * @example
 * ```ts
 * repeatedOption('--file');
 * // 'Option "--file" can be supplied only once. Remove the repeated option.'
 * ```
 */
function repeatedOption(spelling: string): string {
  return `Option ${quoted(spelling)} can be supplied only once. Remove the repeated option.`;
}

/**
 * The sentence for an option word the routed Command's table does not hold, while visible Commands
 * below it declare it. Each Command reads as its path from the root.
 *
 * @example
 * ```ts
 * misplacedOption('--force', [['cache', 'clear']]);
 * // 'Option "--force" belongs to command "cache clear". Supply it after "cache clear".'
 * ```
 */
function misplacedOption(spelling: string, commands: readonly (readonly string[])[]): string {
  const names = commands.map((path) => path.join(' '));
  const [only] = names;
  return names.length === 1 && only !== undefined
    ? `Option ${quoted(spelling)} belongs to command ${quoted(only)}. Supply it after ${quoted(only)}.`
    : `Option ${quoted(spelling)} belongs to commands ${escapedList(names, ', ')}. Supply it after the command name.`;
}

/**
 * The sentence of a working directory the process cannot read.
 *
 * @example
 * ```ts
 * new WorkingDirectoryError({ cause }); // its message is this sentence
 * ```
 */
const workingDirectoryUnreadable =
  'The current working directory cannot be read. Change to a directory that exists and run the command again.';

/**
 * The one sentence a distributed build shows for a defect or a declaration fault, with no reason,
 * class name, code, or path.
 *
 * @example
 * ```ts
 * failureForm(defect, scene).message; // 'Something went wrong.' in a distributed build
 * ```
 */
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
