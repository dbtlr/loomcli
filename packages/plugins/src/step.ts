import { glyph } from '@loomcli/core';
import type { View } from '@loomcli/core';

import { blank, continuation, wrappedLines } from './text-lines.js';

/** The space between the pointer and the step's text. */
const POINTER_GAP = 1;

/**
 * A line that marks a stage of the work: `glyph.pointer` styled `primary`, one space, and the text
 * styled `bold`, ending with a line break. On a terminal the text wraps at `columns` minus that
 * gutter, and each line after the first, authored or wrapped, is indented under the text without
 * repeating the pointer; a blank line among them stays bare. Off a terminal nothing wraps. A text
 * that resolves to no character renders the empty string. The returned value is a bare pack view
 * and installs no plugin behavior; an action writes it at a level, usually `info`'s, so `-q` hides
 * it.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { step } from '@loomcli/plugins/step';
 *
 * new Application('build').action(async ({ out }) => {
 *   await out.info('Building 3 packages', step());
 *   await out.success('Built 3 packages');
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/pack-views.md
 *
 * @public
 */
function step(): View<string> {
  return {
    render: (text, context) => {
      if (blank(text, context)) {
        return '';
      }
      const inset = context.width(glyph.pointer) + POINTER_GAP;
      const indent = ' '.repeat(inset);
      const bold = (line: string) => (blank(line, context) ? line : context.style.bold(line));
      const [first = '', ...rest] = wrappedLines(text, context, inset);
      const lines = [
        `${context.style.primary(glyph.pointer)} ${bold(first)}`,
        ...rest.map((line) => continuation(bold(line), indent, context)),
      ];
      return `${lines.join('\n')}\n`;
    },
  };
}

export { step };
