/*
 * The operator sentences of validation, missing inputs, option groups, and content inputs, under
 * ADR-0164. `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { quoted } from '../failures/messages.js';
import { escapeControlCharacters } from '../support/controls.js';

interface InputSubject {
  readonly kind: 'argument' | 'option';
  readonly spelling: string;
  readonly origin?: string | undefined;
}

function inputSubject(subject: InputSubject): string {
  return subject.kind === 'argument'
    ? `Argument ${quoted(subject.spelling)}`
    : `Option ${quoted(subject.spelling)}${origin(subject.origin)}`;
}

function origin(label: string | undefined): string {
  return label === undefined ? '' : ` (from ${escapeControlCharacters(label)})`;
}

function position(path: string | undefined): string {
  return path === undefined ? '' : ` at ${escapeControlCharacters(path)}`;
}

function issueLine(subject: InputSubject, path: string | undefined, issueSentence: string): string {
  return `${inputSubject(subject)}${position(path)}: ${issueSentence}`;
}

function stdinIssue(issueSentence: string): string {
  return `Stdin: ${issueSentence}`;
}

function ignoredFill(
  fill: { readonly spelling: string; readonly label: string },
  path: string | undefined,
  issueSentence: string,
): string {
  return `Ignored option ${quoted(fill.spelling)}${position(path)} from ${escapeControlCharacters(fill.label)}: ${issueSentence}`;
}

function values(count: number): string {
  return `${String(count)} values`;
}

function missingValues(collected: boolean, arity: number | undefined): string {
  if (arity === undefined) {
    return collected ? 'at least one value' : 'a value';
  }
  return collected ? `at least one set of ${values(arity)}` : values(arity);
}

type OptionFix =
  | { readonly kind: 'spellings'; readonly spellings: readonly string[] }
  | { readonly kind: 'values'; readonly collected: boolean; readonly arity: number | undefined }
  | { readonly kind: 'value' };

/** Names a list quotes, separated by `separator`. */
function quotedList(names: readonly string[], separator: string): string {
  return names.map((name) => quoted(name)).join(separator);
}

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

function requiredOption(
  subject: InputSubject,
  whenNotInteractive: boolean,
  fix: OptionFix,
): string {
  return `${inputSubject(subject)} is required${whenNotInteractive ? ' when input is not interactive' : ''}. ${optionFix(fix)}`;
}

function requiredArgument(name: string, collected: boolean, whenNotInteractive: boolean): string {
  return `Argument ${quoted(name)} requires ${collected ? 'at least one value' : 'a value'}${whenNotInteractive ? ' when input is not interactive' : ''}. Supply a value for ${quoted(name)}.`;
}

const silentRejection =
  'The validator rejected this value without an explanation. Supply a different value.';

function environmentTuple(arity: number, delimiter: string): string {
  return `Use ${values(arity)} separated by ${quoted(delimiter)}.`;
}

const environmentCount = 'Use a whole number of 0 or more.';

const environmentBoolean = 'Use true, false, yes, no, y, n, on, off, 1, or 0.';

const unreadableFile = 'Expected a readable file that exists.';

const filePathsOnly = 'This input accepts file paths only. Use ./- for a file named -.';

const pipedStdin = 'Expected piped or redirected stdin.';

function tooFewSources(minimum: number): string {
  return `Expected at least ${String(minimum)} readable ${minimum === 1 ? 'source' : 'sources'}.`;
}

function tooManySources(maximum: number): string {
  return `Expected at most ${String(maximum)} readable ${maximum === 1 ? 'source' : 'sources'}.`;
}

interface GroupMember {
  readonly spelling: string;
  readonly label: string | undefined;
}

function groupMembers(members: readonly GroupMember[]): string {
  const names = members.map((member) => quoted(member.spelling) + origin(member.label));
  return names.length === 2
    ? names.join(' and ')
    : [names.slice(0, -1).join(', '), names.at(-1) ?? ''].join(', and ');
}

/** A group has no singular subject, so each sentence states the complete relationship. */
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
  tooFewSources,
  tooManySources,
  unreadableFile,
};
