/*
 * The phrasing every sentence of core repeats a value or names a Command through, under ADR-0200:
 * a wording module, which sentences of other modules and Developer Diagnostics compose, so no
 * phrasebook covers it. `tests/message-voice.test.ts` reads it as it reads a message module.
 */
import { valueCode } from '../diagnostics/diagnostic-text.js';
import { escapeControlCharacters } from '../support/controls.js';

/** Escapes a string, and prints any other value as the code a finding prints for it. */
function quoted(value: unknown): string {
  return typeof value === 'string' ? `"${escapeControlCharacters(value)}"` : valueCode(value);
}

function sentenceStart(text: string): string {
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

function commandSubject(name: string | null): string {
  return name === null ? 'the root Command' : `Command ${quoted(name)}`;
}

function routedSubject(command: readonly string[]): string {
  const name = command.at(-1);
  return name === undefined ? 'the root Command' : commandSubject(name);
}

function commandSentence(name: string | null): string {
  return sentenceStart(commandSubject(name));
}

function routedSentence(command: readonly string[]): string {
  return sentenceStart(routedSubject(command));
}

export { commandSentence, commandSubject, quoted, routedSentence, routedSubject };
