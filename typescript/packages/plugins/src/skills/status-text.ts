import { escapeControlCharacters, width } from '@loomcli/core';
import type { ViewContext } from '@loomcli/core';

import { localizedNotes } from '../phrased-notes.js';
import { skillsPhrase } from './phrases.js';
import type { SkillStatus } from './types.js';

const gutter = 2;

const firstRow = 0;

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
    ...localizedNotes(row.notes, context).map((note): [string, string] => [
      context.localize(skillsPhrase('noteLabel')),
      note,
    ]),
  ];
  // A translated label may hold wide characters, so the names pad by display width, not length.
  const column = Math.max(...fields.map(([name]) => width(name))) + gutter;
  const padded = (name: string) => `${name}${' '.repeat(column - width(name))}`;
  return `${index === firstRow ? '' : '\n'}${shown(row.skill)} for ${row.target}: ${row.state}\n${fields.map(([name, value]) => `  ${padded(name)}${value}`).join('\n')}\n`;
}

export { statusText };
