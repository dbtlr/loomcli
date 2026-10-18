import { splitLines } from '@loomcli/core';
import type { ViewContext } from '@loomcli/core';

import { NARROWEST, continuation, terminalWrap, unitWidth } from '../text-lines.js';

/** A view context whose destination is a terminal that reports its width. */
type TerminalContext = ViewContext & { readonly columns: number };

/** Where a hanging text sits: the column its first line starts at, its block's base, and the width. */
interface Hang {
  readonly base: number;
  readonly columns: number;
  readonly lead: number;
}

/** A hanging text's first line, its continuation lines, and the indent they start at. */
interface HungLines {
  readonly first: string;
  readonly indent: number;
  readonly rest: readonly string[];
}

/**
 * The room help hands `terminalWrap` for prose with `width` columns left: none when less than one
 * column is left, so the text keeps its own lines and does not wrap, as the records layout does.
 */
function proseRoom(width: number): number | undefined {
  return width < NARROWEST ? undefined : width;
}

/**
 * Whether help lays its page out against a width. Off a terminal `columns` is undefined, and every
 * page keeps the bytes it had before help read the width.
 */
function onTerminal(context: ViewContext): context is TerminalContext {
  return context.columns !== undefined;
}

/**
 * A hanging text wrapped at `columns`. Its first line starts at `lead`, and its continuation lines
 * start under the first line's text, also at `lead`, unless that indent and the text's floor, the
 * widest unit `wrap` keeps whole in it, exceed the columns. Then they start at `base`, the indent
 * of the text's block, so a narrow screen leaves them room. The first line keeps its place either
 * way: the wrap reads leading spaces that move the first line from `base` to `lead`, which stay
 * with its first word, and drops them from the line it returns.
 */
function hangLines(text: string, { base, columns, lead }: Hang, context: ViewContext): HungLines {
  const expanded = context.expandTabs(text);
  const indent = lead + unitWidth(expanded, context) > columns ? base : lead;
  const offset = ' '.repeat(lead - indent);
  const [first = '', ...rest] = splitLines(
    terminalWrap(`${offset}${expanded}`, context, proseRoom(columns - indent)),
  );
  return { first: first.slice(offset.length), indent, rest };
}

/** Where prose starts: the text before its first line, and the base its block's lines start at. */
interface Placement {
  readonly base?: number;
  readonly lead: string;
}

/**
 * Prose placed after `lead` and wrapped at the columns left after it. Each continuation line starts
 * under the text's first character, after unstyled spaces, or at `base` when that hang cannot fit.
 * Without a base the continuation lines always hang under the text.
 */
function hanging(text: string, { base, lead }: Placement, context: TerminalContext): string[] {
  const start = context.width(lead);
  const { first, indent, rest } = hangLines(
    text,
    { base: base ?? start, columns: context.columns, lead: start },
    context,
  );
  const continued = ' '.repeat(indent);
  return [`${lead}${first}`, ...rest.map((line) => continuation(line, continued, context))];
}

/**
 * Prose after a lead: one line off a terminal, as the page always printed it, and wrapped under a
 * hanging indent on one, continuing at `base` when that hang cannot fit.
 */
function prose(text: string, placement: Placement, context: ViewContext): string[] {
  return onTerminal(context) ? hanging(text, placement, context) : [`${placement.lead}${text}`];
}

export type { TerminalContext };
export { hangLines, hanging, onTerminal, prose, proseRoom };
