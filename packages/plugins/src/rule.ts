import { glyph } from '@loomcli/core';
import type { View } from '@loomcli/core';

import { blank, wrappedLines } from './text-lines.js';

const FIRST = 0;
const LAST_OFFSET = 1;
const LEAD = 2;
const LABEL_INDENT = '   ';
/** The columns a label line gives up: the three before it, and a space and one line after it. */
const LABEL_INSET = 5;
const OFF_TERMINAL_WIDTH = 80;
const SHORTEST_TAIL = 1;
const TAIL_GAP = ' ';

/**
 * A horizontal line across the destination, `columns` wide on a terminal and 80 wide off one.
 * The empty string draws a bare line, and any other text is a label after two line glyphs, wrapped
 * on a terminal with its later lines under it, a blank one left empty, and the line after its last
 * line alone. The returned
 * value is a bare pack view and installs no plugin behavior.
 */
function rule(): View<string> {
  return {
    render: (text, context) => {
      const width = context.columns ?? OFF_TERMINAL_WIDTH;
      if (text === '') {
        return `${context.style.dim(glyph.line.repeat(width))}\n`;
      }
      const lines = wrappedLines(text, context, LABEL_INSET);
      const last = lines.length - LAST_OFFSET;
      const written = lines.map((line, index) => {
        const start =
          index === FIRST ? context.style.dim(`${glyph.line.repeat(LEAD)} `) : LABEL_INDENT;
        if (index !== last) {
          return index !== FIRST && blank(line, context) ? line : `${start}${line}`;
        }
        const used = LABEL_INDENT.length + context.width(line) + TAIL_GAP.length;
        const tail = glyph.line.repeat(Math.max(SHORTEST_TAIL, width - used));
        return `${start}${line}${context.style.dim(`${TAIL_GAP}${tail}`)}`;
      });
      return `${written.join('\n')}\n`;
    },
  };
}

export { rule };
