/*
 * The operator sentences of the dotenv plugin, under ADR-0164: the warnings of a file it could not
 * read and of a line that is not a valid assignment. Each is a function of the values it repeats,
 * and the code that writes the warning calls it. `tests/message-voice.test.ts` holds this module to
 * the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** Every file and name a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/**
 * The warning of a dotenv file that exists and could not be read.
 *
 * @example
 * ```ts
 * fileUnreadable('.env.local');
 * // 'Skipped .env.local: the file could not be read. Make it readable, or remove it.'
 * ```
 */
function fileUnreadable(file: string): string {
  return `Skipped ${shown(file)}: the file could not be read. Make it readable, or remove it.`;
}

/**
 * The warning of a line that is not a valid assignment.
 *
 * @example
 * ```ts
 * lineMalformed('API TOKEN', 3, '.env');
 * // 'Skipped API TOKEN on line 3 of .env: the line is not a valid assignment. Correct the line, or remove it.'
 * ```
 */
function lineMalformed(name: string, line: number, file: string): string {
  return `Skipped ${shown(name)} on line ${String(line)} of ${shown(file)}: the line is not a valid assignment. Correct the line, or remove it.`;
}

export { fileUnreadable, lineMalformed };
