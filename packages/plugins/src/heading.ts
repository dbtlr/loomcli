import { glyph } from '@loomcli/core';
import type { View } from '@loomcli/core';

import { blank, wrappedLines } from './text-lines.js';

const NO_INSET = 0;
const UNDERLINED = 1;

interface HeadingConfig {
  // The two levels are the contract's own literal type, which names no constant.
  // oxlint-disable-next-line eslint/no-magic-numbers
  readonly level?: 1 | 2;
}

/**
 * A section heading over its text, styled `dim`. Level 1, the default, adds an underline of
 * `glyph.line` as wide as the widest line of the text, and level 2 is the text alone. On a
 * terminal the text wraps at `columns` and the underline matches the widest wrapped line. A text
 * that resolves to no character prints nothing. The returned value is a bare pack view and
 * installs no plugin behavior.
 */
function heading(config: HeadingConfig = {}): View<string> {
  const underlined = (config.level ?? UNDERLINED) === UNDERLINED;
  return {
    render: (text, context) => {
      if (blank(text, context)) {
        return '';
      }
      const lines = wrappedLines(text, context, NO_INSET);
      const written = lines.map((line) => context.style.dim(line));
      if (underlined) {
        const widest = context.width(lines.join('\n'));
        written.push(context.style.dim(glyph.line.repeat(widest)));
      }
      return `${written.join('\n')}\n`;
    },
  };
}

export { heading };
export type { HeadingConfig };
