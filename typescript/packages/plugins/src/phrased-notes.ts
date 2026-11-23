/*
 * The notes a result or a row keeps as English text, with the phrase behind each note carried
 * beside the array, so a text view says each note in the run's language while the JSON view keeps
 * the English. The array is the key, so the phrases travel through a spread that copies the
 * record around it.
 */
import type { Phrase, ViewContext } from '@loomcli/core';

const carried = new WeakMap<readonly string[], readonly Phrase[]>();

/** The English text of each phrase, as the array a result or a row keeps, with the phrases carried beside it. */
function phrasedNotes(phrases: readonly Phrase[]): readonly string[] {
  const notes = phrases.map((phrase) => phrase.text);
  carried.set(notes, phrases);
  return notes;
}

/** The notes as text for a person: each carried phrase in the run's language, else the note's own text. */
function localizedNotes(notes: readonly string[], context: ViewContext): readonly string[] {
  const phrases = carried.get(notes);
  return phrases === undefined ? notes : phrases.map((phrase) => context.localize(phrase));
}

export { localizedNotes, phrasedNotes };
