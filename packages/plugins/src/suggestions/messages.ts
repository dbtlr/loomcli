/*
 * The operator sentences of the suggestions plugin, under ADR-0164. `tests/message-voice.test.ts`
 * holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const shown = escapeControlCharacters;

const shownNames = (names: readonly string[]): string => names.map(shown).join(', ');

function didYouMeanOne(name: string): string {
  return `Did you mean "${shown(name)}"?`;
}

function didYouMeanMany(names: readonly string[]): string {
  return `Did you mean one of these: ${shownNames(names)}?`;
}

/** An unknown command or option with the one declared name nearest it. */
function unknownWithSuggestion(kind: 'command' | 'option', typed: string, name: string): string {
  return `Unknown ${shown(kind)} "${shown(typed)}". ${didYouMeanOne(name)}`;
}

/** An unknown command or option with the several declared names nearest it. */
function unknownWithSuggestions(
  kind: 'command' | 'option',
  typed: string,
  names: readonly string[],
): string {
  return `Unknown ${shown(kind)} "${shown(typed)}". ${didYouMeanMany(names)}`;
}

/** The fix for a rejected value that names the one accepted candidate, never the received value. */
function valueSuggestion(name: string): string {
  return didYouMeanOne(name);
}

/** The fix for a rejected value that names several accepted candidates, never the received value. */
function valueSuggestions(names: readonly string[]): string {
  return didYouMeanMany(names);
}

export { unknownWithSuggestion, unknownWithSuggestions, valueSuggestion, valueSuggestions };
