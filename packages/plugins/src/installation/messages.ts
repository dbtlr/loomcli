/*
 * The operator sentences of the installed-files module, under ADR-0164. Each caller is a different
 * command, so a step names no command. `tests/message-voice.test.ts` holds this module to the
 * failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

const shown = escapeControlCharacters;

const shownPath = (path: string): string => nowrap(shown(path));

/** A read, a write, or a removal at a path one of whose folders is a file. */
function pathBlocked(path: string): string {
  return `Cannot reach ${shownPath(path)} because a file sits where one of its folders is needed. Remove or rename that file, then run the command again.`;
}

function writeUnwritable(path: string, readOnly: boolean): string {
  return `Cannot write ${shownPath(path)} because ${readOnly ? 'the file system is read-only' : 'you do not have permission to write there'}. Make the location writable, then run the command again.`;
}

export { pathBlocked, writeUnwritable };
