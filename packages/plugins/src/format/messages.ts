/*
 * The operator sentences of the format plugin, under ADR-0164: the issue of a `--format` value that
 * names no view. `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** The view names an issue offers, each escaped, joined with commas. */
const shownNames = (names: readonly string[]): string =>
  names.map(escapeControlCharacters).join(', ');

/**
 * The issue of a `--format` value that names none of the views.
 *
 * @example
 * ```ts
 * formatIssue(['text', 'json', 'jsonl']); // 'Supply one of text, json, jsonl.'
 * ```
 */
function formatIssue(names: readonly string[]): string {
  return `Supply one of ${shownNames(names)}.`;
}

export { formatIssue };
