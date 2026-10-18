import { splitLines } from '@loomcli/core';
import type { ViewContext } from '@loomcli/core';

/** A view context whose destination is a terminal that reports its width. */
type TerminalContext = ViewContext & { readonly columns: number };

const FIRST = 0;
const NARROWEST = 1;

/**
 * Whether help lays its page out against a width. Off a terminal `columns` is undefined, and every
 * page keeps the bytes it had before help read the width.
 */
function onTerminal(context: ViewContext): context is TerminalContext {
  return context.columns !== undefined;
}

/**
 * Prose as the lines it wraps to at `width` columns, each line standing alone for the indent placed
 * before it. Its tabs expand first, counted from the text's own start, so the lines hold none. With
 * less than one column left, the text keeps its own lines and does not wrap.
 */
function proseLines(text: string, width: number, context: ViewContext): string[] {
  const expanded = context.expandTabs(text);
  return splitLines(width < NARROWEST ? expanded : context.wrap(expanded, width));
}

/**
 * Lines under a hanging indent: the first after `lead`, and each later one after `indent` spaces,
 * which is unstyled. A later line that resolves to nothing stays bare, so no line ends in a space.
 */
function hang(
  lines: readonly string[],
  { indent, lead }: { indent: number; lead: string },
  context: ViewContext,
): string[] {
  const spaces = ' '.repeat(indent);
  return lines.map((line, index) => {
    if (index === FIRST) {
      return `${lead}${line}`;
    }
    return context.plain(line) === '' ? '' : `${spaces}${line}`;
  });
}

/**
 * Prose placed after `lead` and wrapped at the columns left after it, so each continuation line
 * starts under the text's first character.
 */
function hanging(text: string, lead: string, context: TerminalContext): string[] {
  const indent = context.width(lead);
  return hang(proseLines(text, context.columns - indent, context), { indent, lead }, context);
}

/**
 * Prose after a lead: one line off a terminal, as the page always printed it, and wrapped under a
 * hanging indent on one.
 */
function prose(text: string, lead: string, context: ViewContext): string[] {
  return onTerminal(context) ? hanging(text, lead, context) : [`${lead}${text}`];
}

export type { TerminalContext };
export { hang, hanging, onTerminal, prose, proseLines };
