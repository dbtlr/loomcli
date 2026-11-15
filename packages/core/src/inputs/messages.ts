/*
 * The operator sentences of the validation phase, of missing inputs, of option groups, and of
 * content inputs, under ADR-0164. Each sentence is a function of the values it repeats, or a
 * constant, and the code that reports the problem calls it. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { quoted } from '../failures/messages.js';
import { escapeControlCharacters } from '../support/controls.js';

/**
 * How a sentence names one input: its kind, the spelling that reaches it, and, for an option an
 * input source filled, where its value came from.
 *
 * @example
 * ```ts
 * const subject: InputSubject = { kind: 'option', origin: 'JSONKIT_WORKERS', spelling: '--workers' };
 * ```
 */
interface InputSubject {
  readonly kind: 'argument' | 'option';
  readonly spelling: string;
  readonly origin?: string | undefined;
}

/**
 * An input as a sentence opens with it. A value an input source filled adds its source in
 * parentheses, so the operator learns where it came from.
 *
 * @example
 * ```ts
 * inputSubject({ kind: 'option', origin: 'JSONKIT_WORKERS', spelling: '--workers' });
 * // 'Option "--workers" (from JSONKIT_WORKERS)'
 * ```
 */
function inputSubject(subject: InputSubject): string {
  return subject.kind === 'argument'
    ? `Argument ${quoted(subject.spelling)}`
    : `Option ${quoted(subject.spelling)}${origin(subject.origin)}`;
}

/** The parenthesized source of a filled value, or nothing for a value no source filled. */
function origin(label: string | undefined): string {
  return label === undefined ? '' : ` (from ${escapeControlCharacters(label)})`;
}

/** Where inside a value an issue points, or nothing for an issue about the value itself. */
function position(path: string | undefined): string {
  return path === undefined ? '' : ` at ${escapeControlCharacters(path)}`;
}

/**
 * One issue's line under an input's subject. A path segment can hold text the operator typed, such
 * as a key of a record, so the line escapes the path. The issue's sentence is its validator's,
 * which core repeats after the input's name as the validator wrote it.
 *
 * @example
 * ```ts
 * issueLine({ kind: 'option', spelling: '--workers' }, undefined, 'Expected a whole number.');
 * // 'Option "--workers": Expected a whole number.'
 * ```
 */
function issueLine(subject: InputSubject, path: string | undefined, issueSentence: string): string {
  return `${inputSubject(subject)}${position(path)}: ${issueSentence}`;
}

/**
 * One issue's line about the content stdin carries.
 *
 * @example
 * ```ts
 * stdinIssue('Expected piped or redirected stdin.'); // 'Stdin: Expected piped or redirected stdin.'
 * ```
 */
function stdinIssue(issueSentence: string): string {
  return `Stdin: ${issueSentence}`;
}

/**
 * The `-v` line of a value the configuration source filled that its validator rejected, which
 * falls back as if no tier had supplied it, naming the value's first issue.
 *
 * @example
 * ```ts
 * ignoredFill({ label: '"workers" in settings.json', spelling: '--workers' }, undefined, 'Expected a whole number.');
 * ```
 */
function ignoredFill(
  fill: { readonly spelling: string; readonly label: string },
  path: string | undefined,
  issueSentence: string,
): string {
  return `Ignored option ${quoted(fill.spelling)}${position(path)} from ${escapeControlCharacters(fill.label)}: ${issueSentence}`;
}

/** An arity option's count of values, as its sentences name it. */
function values(count: number): string {
  return `${String(count)} values`;
}

/**
 * What the fix clause of a missing option asks for: a value, at least one of a collected option's,
 * an arity option's count of values, or at least one set of them on a multiple arity option.
 *
 * @example
 * ```ts
 * missingValues(true, 2); // 'at least one set of 2 values'
 * ```
 */
function missingValues(collected: boolean, arity: number | undefined): string {
  if (arity === undefined) {
    return collected ? 'at least one value' : 'a value';
  }
  return collected ? `at least one set of ${values(arity)}` : values(arity);
}

/**
 * What the fix of a missing option asks for: one of a Boolean option's spellings, the values its
 * declaration takes, or a value.
 *
 * @example
 * ```ts
 * const fix: OptionFix = { arity: undefined, collected: false, kind: 'values' };
 * ```
 */
type OptionFix =
  | { readonly kind: 'spellings'; readonly spellings: readonly string[] }
  | { readonly kind: 'values'; readonly collected: boolean; readonly arity: number | undefined }
  | { readonly kind: 'value' };

/** Names a list quotes, separated by `separator`. */
function quotedList(names: readonly string[], separator: string): string {
  return names.map((name) => quoted(name)).join(separator);
}

/** The fix clause of a missing option. */
function optionFix(fix: OptionFix): string {
  switch (fix.kind) {
    case 'spellings': {
      return `Supply ${quotedList(fix.spellings, ' or ')}.`;
    }
    case 'values': {
      return `Supply ${missingValues(fix.collected, fix.arity)}.`;
    }
    default: {
      return 'Supply a value.';
    }
  }
}

/**
 * The sentence of an omitted required option, required always or only when input is not
 * interactive, which names its source when one filled an empty list.
 *
 * @example
 * ```ts
 * requiredOption({ kind: 'option', spelling: '--target' }, false, { kind: 'value' });
 * // 'Option "--target" is required. Supply a value.'
 * ```
 */
function requiredOption(
  subject: InputSubject,
  whenNotInteractive: boolean,
  fix: OptionFix,
): string {
  return `${inputSubject(subject)} is required${whenNotInteractive ? ' when input is not interactive' : ''}. ${optionFix(fix)}`;
}

/**
 * The sentence of an omitted required argument, which asks a collected argument for at least one
 * value.
 *
 * @example
 * ```ts
 * requiredArgument('files', true, false);
 * // 'Argument "files" requires at least one value. Supply a value for "files".'
 * ```
 */
function requiredArgument(name: string, collected: boolean, whenNotInteractive: boolean): string {
  return `Argument ${quoted(name)} requires ${collected ? 'at least one value' : 'a value'}${whenNotInteractive ? ' when input is not interactive' : ''}. Supply a value for ${quoted(name)}.`;
}

/**
 * The issue of a validator that rejected a value without one, which the operator fixes by
 * supplying another value.
 *
 * @example
 * ```ts
 * const issues = [{ message: silentRejection }];
 * ```
 */
const silentRejection =
  'The validator rejected this value without an explanation. Supply a different value.';

/**
 * The issue of an environment variable an arity option reads that does not split into its count
 * of items.
 *
 * @example
 * ```ts
 * environmentTuple(2, ','); // 'Use 2 values separated by ",".'
 * ```
 */
function environmentTuple(arity: number, delimiter: string): string {
  return `Use ${values(arity)} separated by ${quoted(delimiter)}.`;
}

/**
 * The issue of an environment variable outside a counted option's grammar.
 *
 * @example
 * ```ts
 * const issues = [{ message: environmentCount }];
 * ```
 */
const environmentCount = 'Use a whole number of 0 or more.';

/**
 * The issue of an environment variable outside a Boolean option's grammar.
 *
 * @example
 * ```ts
 * const issues = [{ message: environmentBoolean }];
 * ```
 */
const environmentBoolean = 'Use true, false, yes, no, y, n, on, off, 1, or 0.';

/**
 * The issue of a content input whose file cannot be read.
 *
 * @example
 * ```ts
 * const issues = [{ message: unreadableFile }];
 * ```
 */
const unreadableFile = 'Expected a readable file that exists.';

/**
 * The issue of `-` on a content input that takes no stdin.
 *
 * @example
 * ```ts
 * const issues = [{ message: filePathsOnly }];
 * ```
 */
const filePathsOnly = 'This input accepts file paths only. Use ./- for a file named -.';

/**
 * The issue of `-` on a content input when stdin is a terminal or the run was invoked by name.
 *
 * @example
 * ```ts
 * const issues = [{ message: pipedStdin }];
 * ```
 */
const pipedStdin = 'Expected piped or redirected stdin.';

/**
 * One member of a broken option group: the spelling that reaches it, and the source that filled
 * it, if one did.
 *
 * @example
 * ```ts
 * const member: GroupMember = { label: undefined, spelling: '--json' };
 * ```
 */
interface GroupMember {
  readonly spelling: string;
  readonly label: string | undefined;
}

/** The members of a group as its sentence lists them: two joined by `and`, more in a series. */
function groupMembers(members: readonly GroupMember[]): string {
  const names = members.map((member) => quoted(member.spelling) + origin(member.label));
  return names.length === 2
    ? names.join(' and ')
    : [names.slice(0, -1).join(', '), names.at(-1) ?? ''].join(', and ');
}

/**
 * A group has no singular subject, so each sentence states the complete relationship.
 *
 * @example
 * ```ts
 * groupSentence('exclusive', [
 *   { label: undefined, spelling: '--json' },
 *   { label: undefined, spelling: '--yaml' },
 * ]);
 * // 'Options "--json" and "--yaml" cannot be used together. Supply only one of them.'
 * ```
 */
function groupSentence(
  kind: 'exclusive' | 'oneRequired' | 'requiredTogether',
  members: readonly GroupMember[],
): string {
  switch (kind) {
    case 'exclusive': {
      return `Options ${groupMembers(members)} cannot be used together. Supply only one of them.`;
    }
    case 'oneRequired': {
      return `One of options ${groupMembers(members)} is required. Supply at least one of them.`;
    }
    default: {
      return `Options ${groupMembers(members)} must be supplied together. Supply all of them, or none.`;
    }
  }
}

export type { GroupMember, InputSubject, OptionFix };
export {
  environmentBoolean,
  environmentCount,
  environmentTuple,
  filePathsOnly,
  groupSentence,
  ignoredFill,
  inputSubject,
  issueLine,
  missingValues,
  pipedStdin,
  requiredArgument,
  requiredOption,
  silentRejection,
  stdinIssue,
  unreadableFile,
};
