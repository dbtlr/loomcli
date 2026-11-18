import { escapeControlCharacters } from '@loomcli/core';

import type { SkillStatus } from './types.js';

const gutter = 2;
const firstRow = 0;

/** The default row view, with one blank line between skill blocks. */
function statusText(row: Readonly<SkillStatus>, index: number): string {
  const shown = escapeControlCharacters;
  const fields: [string, string][] = [
    ['folder', shown(row.folder)],
    ...(row.state === 'modified'
      ? row.files.map((file): [string, string] => ['changed', shown(file)])
      : []),
    ...row.notes.map((note): [string, string] => ['note', note]),
  ];
  const width = Math.max(...fields.map(([name]) => name.length)) + gutter;
  return `${index === firstRow ? '' : '\n'}${shown(row.skill)} for ${row.target}: ${row.state}\n${fields.map(([name, value]) => `  ${name.padEnd(width)}${value}`).join('\n')}\n`;
}

export { statusText };
