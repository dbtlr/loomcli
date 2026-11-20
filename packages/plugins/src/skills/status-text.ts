import { escapeControlCharacters, width } from '@loomcli/core';
import type { Phrase, ViewContext } from '@loomcli/core';

import { skillsPhrase } from './phrases.js';
import type { SkillStatus } from './types.js';

const gutter = 2;

/** The phrase of each note of a row this run built, so the text view renders it in the run's language. */
const notePhrases = new WeakMap<object, readonly Phrase[]>();

/** Remembers the phrases behind a row's `notes`, which stay English text in the row itself. */
function rememberNotes(row: SkillStatus, notes: readonly Phrase[]): SkillStatus {
  notePhrases.set(row, notes);
  return row;
}

const firstRow = 0;

/** The row's notes as text for a person: each phrase in the run's language, else the row's own text. */
function notesOf(row: Readonly<SkillStatus>, context: ViewContext): readonly string[] {
  const phrases = notePhrases.get(row);
  return phrases === undefined ? row.notes : phrases.map((phrase) => context.localize(phrase));
}

/** The default row view, with one blank line between skill blocks. */
function statusText(row: Readonly<SkillStatus>, index: number, context: ViewContext): string {
  const shown = escapeControlCharacters;
  const fields: [string, string][] = [
    [context.localize(skillsPhrase('folderLabel')), shown(row.folder)],
    ...(row.state === 'modified'
      ? row.files.map((file): [string, string] => [
          context.localize(skillsPhrase('changedLabel')),
          shown(file),
        ])
      : []),
    ...notesOf(row, context).map((note): [string, string] => [
      context.localize(skillsPhrase('noteLabel')),
      note,
    ]),
  ];
  // A translated label may hold wide characters, so the names pad by display width, not length.
  const column = Math.max(...fields.map(([name]) => width(name))) + gutter;
  const padded = (name: string) => `${name}${' '.repeat(column - width(name))}`;
  return `${index === firstRow ? '' : '\n'}${shown(row.skill)} for ${row.target}: ${row.state}\n${fields.map(([name, value]) => `  ${padded(name)}${value}`).join('\n')}\n`;
}

export { rememberNotes, statusText };
