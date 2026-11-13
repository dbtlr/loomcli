import type { View } from '@loomcli/core';

import { blank, headingLines, wrappedLines } from './text-lines.js';

const NO_INSET = 0;
const DEFAULT_LEVEL = 1;

/**
 * What an author tells `heading()`: the level of the heading.
 *
 * @public
 */
interface HeadingConfig {
  /** Level 1 underlines the text, and level 2 prints the text alone. Level 1 by default. */
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
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { heading } from '@loomcli/plugins/heading';
 *
 * export const title = new Command('title')
 *   .result<string>({ views: { heading: heading({ level: 2 }) } })
 *   .action(async () => 'Recent notes');
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/pack-views.md
 *
 * @public
 */
function heading(config: HeadingConfig = {}): View<string> {
  const level = config.level ?? DEFAULT_LEVEL;
  return {
    render: (text, context) => {
      if (blank(text, context)) {
        return '';
      }
      const lines = headingLines(wrappedLines(text, context, NO_INSET), level, context);
      return `${lines.join('\n')}\n`;
    },
  };
}

export { heading };
export type { HeadingConfig };
