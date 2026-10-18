import { splitLines } from '@loomcli/core';
import type { ViewContext } from '@loomcli/core';

/**
 * The line layout the pack's terminal views share: wrapping a text into lines that stand alone,
 * indenting the lines that continue it, and measuring the widest unit a wrap keeps whole. Help,
 * the table, and the records layout have to agree on how text wraps and continues, so each of them
 * reads it from here. This module belongs to no subpath: help and the table views both import it,
 * and neither imports the other's.
 */

/** The narrowest width a wrap takes, one column. */
const NARROWEST = 1;

/**
 * The widest unit `wrap` keeps whole in a text: a word, with an input line's leading spaces on its
 * first word and its trailing spaces on its last, or a `pad` or `nowrap` frame. It reads `wrap`
 * itself at one column, so the floor and the wrap agree on every unit. A table column's floor and
 * a help row set's floor both read it.
 */
function unitWidth(text: string, context: Pick<ViewContext, 'width' | 'wrap'>): number {
  return context.width(context.wrap(text, NARROWEST));
}

/**
 * A text as the lines it wraps to at `width` columns, each line standing alone for the indent placed
 * before it. Its tabs expand first, counted from the text's own start, so the lines hold none. A
 * caller that must measure or expand tabs per line, such as from each authored line's start, does
 * that first, and the expansion here then finds no tab and changes nothing. With less than one
 * column left, the text keeps its own lines and does not wrap.
 */
function wrapLines(
  text: string,
  width: number,
  context: Pick<ViewContext, 'expandTabs' | 'wrap'>,
): string[] {
  const expanded = context.expandTabs(text);
  return splitLines(width < NARROWEST ? expanded : context.wrap(expanded, width));
}

/**
 * Lines that continue a text, each placed after `indent`, which is unstyled. A line that resolves
 * to nothing stays bare, so no line ends in a space.
 */
function indentLines(
  lines: readonly string[],
  indent: string,
  context: Pick<ViewContext, 'plain'>,
): string[] {
  return lines.map((line) => (context.plain(line) === '' ? line : `${indent}${line}`));
}

export { indentLines, NARROWEST, unitWidth, wrapLines };
