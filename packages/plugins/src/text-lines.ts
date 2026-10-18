import { splitLines } from '@loomcli/core';
import type { ViewContext } from '@loomcli/core';

const NARROWEST = 1;

/** Whether a line resolves to no character at all, whatever frames it holds. */
function blank(text: string, context: ViewContext): boolean {
  return context.plain(text) === '';
}

/**
 * A block of marked text as lines that each stand alone. On a terminal its tabs expand from the
 * start of each input line, then it wraps at the context's columns less `inset`, the columns
 * placed before it, and at 1 when that leaves less. Off a terminal it is not wrapped and its tabs
 * stay as written. Either way it is split with `splitLines`, so a style or a hyperlink never runs
 * into what the caller places beside a line, and a trailing line break adds no line.
 */
function wrappedLines(text: string, context: ViewContext, inset: number): string[] {
  if (context.columns === undefined) {
    return splitLines(text);
  }
  const room = Math.max(NARROWEST, context.columns - inset);
  return splitLines(context.wrap(context.expandTabs(text), room));
}

export { blank, wrappedLines };
