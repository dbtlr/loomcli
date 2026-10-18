import type { ViewContext } from '@loomcli/core';

import { indentLines, wrapLines } from '../text-layout.js';

/** A view context whose destination is a terminal that reports its width. */
type TerminalContext = ViewContext & { readonly columns: number };

/**
 * Whether help lays its page out against a width. Off a terminal `columns` is undefined, and every
 * page keeps the bytes it had before help read the width.
 */
function onTerminal(context: ViewContext): context is TerminalContext {
  return context.columns !== undefined;
}

/**
 * Prose placed after `lead` and wrapped at the columns left after it, so each continuation line
 * starts under the text's first character, after unstyled spaces as wide as the lead.
 */
function hanging(text: string, lead: string, context: TerminalContext): string[] {
  const indent = context.width(lead);
  const [first = '', ...rest] = wrapLines(text, context.columns - indent, context);
  return [`${lead}${first}`, ...indentLines(rest, ' '.repeat(indent), context)];
}

/**
 * Prose after a lead: one line off a terminal, as the page always printed it, and wrapped under a
 * hanging indent on one.
 */
function prose(text: string, lead: string, context: ViewContext): string[] {
  return onTerminal(context) ? hanging(text, lead, context) : [`${lead}${text}`];
}

export type { TerminalContext };
export { hanging, onTerminal, prose };
