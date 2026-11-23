/*
 * The operator sentences several plugins share, under ADR-0164. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const shown = escapeControlCharacters;

function homeNotAbsolute(name: string): string {
  return `${shown(name)} cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.`;
}

function recordDirectoryNotAbsolute(name: string, variable: string): string {
  return `${shown(name)} cannot find its installation record because ${shown(variable)} is not an absolute path. Set ${shown(variable)} to an absolute path, then run the command again.`;
}

const single = 1;

/** The summary under a records view: how many records it printed. */
function recordCount(count: number): string {
  return `${String(count)} ${count === single ? 'record' : 'records'}`;
}

/** Two names join with `and` alone. */
const pairMembers = 2;
const listStart = 0;
const lastMember = -1;

/** Spellings joined for a sentence, each escaped: `a`, `a and b`, or `a, b, and c`. */
function joined(names: readonly string[]): string {
  const spelled = names.map(shown);
  if (spelled.length <= pairMembers) {
    return spelled.join(' and ');
  }
  return [spelled.slice(listStart, lastMember).join(', '), spelled.at(lastMember) ?? ''].join(
    ', and ',
  );
}

/** What an option group's sentence adds when a member reads piped stdin, which does not count. */
function caveat(stdin: boolean): string {
  return stdin ? ' (piped stdin does not count)' : '';
}

/** The sentence help and the man page print for an exclusive option group. */
function exclusiveGroup(members: readonly string[], stdin: boolean): string {
  return `Use at most one of ${joined(members)}${caveat(stdin)}.`;
}

/** The sentence help and the man page print for a group of which one option is required. */
function oneRequiredGroup(members: readonly string[], stdin: boolean): string {
  return `Supply at least one of ${joined(members)}${caveat(stdin)}.`;
}

/** The sentence help and the man page print for a group whose options are used together. */
function requiredTogetherGroup(members: readonly string[], stdin: boolean): string {
  return `Use ${joined(members)} together${caveat(stdin)}.`;
}

/** The sentence help and the man page print for an option that requires others. */
function requiresGroup(option: string, requires: readonly string[], stdin: boolean): string {
  return `Use ${shown(option)} only with ${joined(requires)}${caveat(stdin)}.`;
}

/** The four shared change-event templates, shown on screen at -v. */
const fileWrittenMessage = 'File written.';
const fileRemovedMessage = 'File removed.';
const programRunMessage = 'Program run.';
const binaryReplacedMessage = 'Binary replaced.';

export {
  binaryReplacedMessage,
  exclusiveGroup,
  fileRemovedMessage,
  fileWrittenMessage,
  homeNotAbsolute,
  oneRequiredGroup,
  programRunMessage,
  recordCount,
  recordDirectoryNotAbsolute,
  requiredTogetherGroup,
  requiresGroup,
};
