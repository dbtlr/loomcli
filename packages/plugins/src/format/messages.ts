/*
 * The operator sentences of the format plugin, under ADR-0164. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const shownNames = (names: readonly string[]): string =>
  names.map(escapeControlCharacters).join(', ');

function formatIssue(names: readonly string[]): string {
  return `Supply one of ${shownNames(names)}.`;
}

export { formatIssue };
