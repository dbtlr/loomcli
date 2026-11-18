/*
 * The operator sentences of the suggestions plugin, under ADR-0164. `tests/message-voice.test.ts`
 * holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const shown = escapeControlCharacters;

const shownNames = (names: readonly string[]): string => names.map(shown).join(', ');

function didYouMean(first: string, names: readonly string[]): string {
  const [, second] = names;
  return second === undefined
    ? `Did you mean "${shown(first)}"?`
    : `Did you mean one of these: ${shownNames(names)}?`;
}

function unknownWithSuggestion(
  kind: 'command' | 'option',
  typed: string,
  names: readonly string[],
): string | undefined {
  const [first] = names;
  return first === undefined
    ? undefined
    : `Unknown ${shown(kind)} "${shown(typed)}". ${didYouMean(first, names)}`;
}

/** The fix for a rejected value names accepted candidates alone, never the received value. */
function valueSuggestion(names: readonly string[]): string | undefined {
  const [first] = names;
  return first === undefined ? undefined : didYouMean(first, names);
}

export { unknownWithSuggestion, valueSuggestion };
