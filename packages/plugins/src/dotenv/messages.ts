/*
 * The operator sentences of the dotenv plugin, under ADR-0164. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const shown = escapeControlCharacters;

function fileUnreadable(file: string): string {
  return `Skipped ${shown(file)}: the file could not be read. Make it readable, or remove it.`;
}

function lineMalformed(name: string, line: number, file: string): string {
  return `Skipped ${shown(name)} on line ${String(line)} of ${shown(file)}: the line is not a valid assignment. Correct the line, or remove it.`;
}

export { fileUnreadable, lineMalformed };
