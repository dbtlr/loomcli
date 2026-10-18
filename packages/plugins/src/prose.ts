import type { View } from '@loomcli/core';

import { wrappedLines } from './text-lines.js';

const NO_INSET = 0;

/**
 * Paragraphs wrapped to the destination, with no styling added. On a terminal the text wraps at
 * `columns`, its authored line breaks and blank lines kept, and its continuation lines start at
 * column 0. Off a terminal it prints as written, with a newline added when it does not end in a
 * line break. The returned value is a bare pack view and installs no plugin behavior.
 */
function prose(): View<string> {
  return {
    render: (text, context) => {
      if (text === '') {
        return '';
      }
      if (context.columns === undefined) {
        return context.plain(text).endsWith('\n') ? text : `${text}\n`;
      }
      return `${wrappedLines(text, context, NO_INSET).join('\n')}\n`;
    },
  };
}

export { prose };
