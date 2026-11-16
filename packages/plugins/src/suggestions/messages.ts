/*
 * The operator sentences of the suggestions plugin, under ADR-0164: the sentence its failure views
 * write in place of core's for a mistyped Command or option, with the nearest declared names as its
 * fix. `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** Every typed word and declared name a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/** The names a fix offers, each escaped, joined with commas. */
const shownNames = (names: readonly string[]): string => names.map(shown).join(', ');

/** The fix that offers one name, or several. */
function didYouMean(first: string, names: readonly string[]): string {
  const [, second] = names;
  return second === undefined
    ? `Did you mean "${shown(first)}"?`
    : `Did you mean one of these: ${shownNames(names)}?`;
}

/**
 * The sentence that names what the operator typed and offers the nearest declared names as its fix,
 * or `undefined` when no name is near. A declared option name is escaped too, because the
 * declared-name rule allows a control character.
 *
 * @example
 * ```ts
 * unknownWithSuggestion('command', 'stauts', ['status']);
 * // 'Unknown command "stauts". Did you mean "status"?'
 * ```
 */
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

export { unknownWithSuggestion };
