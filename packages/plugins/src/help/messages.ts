/*
 * The operator sentences of the help plugin, under ADR-0164: the hint line it adds under a usage
 * error. Help's headings, labels, and facts stay with the views that print them.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** A command line as its words joined by single spaces, each escaped. */
const shownCommand = (words: readonly string[]): string =>
  words.map(escapeControlCharacters).join(' ');

/**
 * The hint under a usage error, which points at the help page of the Command routing reached.
 *
 * @example
 * ```ts
 * usageHint(['notes', 'add']); // 'Run "notes add --help" to see the usage.'
 * ```
 */
function usageHint(command: readonly string[]): string {
  return `Run "${shownCommand([...command, '--help'])}" to see the usage.`;
}

export { usageHint };
