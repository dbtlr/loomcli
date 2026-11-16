/*
 * The operator sentences of the logging plugin, under ADR-0164 and ADR-0165: its `-v` and `-vv`
 * lines. `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

/** A path, escaped and kept on one line. */
function shownPath(path: string): string {
  return nowrap(escapeControlCharacters(path));
}

/** The `-v` line that names the file the plugin appends records to. */
function loggingTo(path: string): string {
  return `Logging to ${shownPath(path)}.`;
}

/** The `-vv` line for a rotation that renamed or deleted the file. */
function rotated(path: string): string {
  return `Rotated ${shownPath(path)}.`;
}

export { loggingTo, rotated };
