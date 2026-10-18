import { glyph } from '@loomcli/core';
import type { View } from '@loomcli/core';

import { blank, continuation, wrappedLines } from './text-lines.js';

const FIRST = 0;
const LAST_OFFSET = 1;
const LEAD_GAP = ' ';
const LEAD_LINES = 2;
const OFF_TERMINAL_WIDTH = 80;
const SHORTEST_TAIL = 1;
const TAIL_GAP = ' ';

/**
 * A horizontal line across the destination, `columns` wide on a terminal and 80 wide off one. A
 * text that resolves to no character draws a bare line, and any other text is a label after two
 * line glyphs. On a terminal the label wraps, its later lines start under it, a blank one among
 * them stays empty, and only its last line carries the line after it. The returned value is a bare
 * pack view and installs no plugin behavior.
 */
function rule(): View<string> {
  return {
    render: (text, context) => {
      const width = context.columns ?? OFF_TERMINAL_WIDTH;
      if (blank(text, context)) {
        return `${context.style.dim(glyph.line.repeat(width))}\n`;
      }
      const lead = context.style.dim(`${glyph.line.repeat(LEAD_LINES)}${LEAD_GAP}`);
      // The label's later lines start under it, as far in as the lead is wide.
      const indent = ' '.repeat(context.width(lead));
      // Each label line gives up the columns before it, and a gap and the shortest tail after it.
      const inset = indent.length + TAIL_GAP.length + SHORTEST_TAIL;
      const lines = wrappedLines(text, context, inset);
      const last = lines.length - LAST_OFFSET;
      const written = lines.map((line, index) => {
        if (index === FIRST && index !== last) {
          return `${lead}${line}`;
        }
        if (index !== last) {
          return continuation(line, indent, context);
        }
        const start = index === FIRST ? lead : indent;
        const used = indent.length + context.width(line) + TAIL_GAP.length;
        const tail = glyph.line.repeat(Math.max(SHORTEST_TAIL, width - used));
        return `${start}${line}${context.style.dim(`${TAIL_GAP}${tail}`)}`;
      });
      return `${written.join('\n')}\n`;
    },
  };
}

export { rule };
