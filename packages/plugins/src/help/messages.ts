/*
 * The operator sentences of the help plugin, under ADR-0164: the hint under a usage error.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const shownCommand = (words: readonly string[]): string =>
  words.map(escapeControlCharacters).join(' ');

function usageHint(command: readonly string[]): string {
  return `Run "${shownCommand([...command, '--help'])}" to see the usage.`;
}

export { usageHint };
