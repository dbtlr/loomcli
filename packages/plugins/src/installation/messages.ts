/*
 * The operator sentences of the installed-files module, under ADR-0164. Each caller is a different
 * command, so a step names no command. `tests/message-voice.test.ts` holds this module to the
 * failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

const shown = escapeControlCharacters;

const shownPath = (path: string): string => nowrap(shown(path));

function writeBlocked(path: string): string {
  return `Cannot write ${shownPath(path)} because a file sits where a folder is needed. Remove or rename the file, then run the command again.`;
}

function writeUnwritable(path: string, readOnly: boolean): string {
  return `Cannot write ${shownPath(path)} because ${readOnly ? 'the file system is read-only' : 'you do not have permission to write there'}. Make the location writable, then run the command again.`;
}

export { writeBlocked, writeUnwritable };
