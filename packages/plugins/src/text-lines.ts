import { splitLines } from '@loomcli/core';
import type { ViewContext } from '@loomcli/core';

/**
 * The line layout the pack's terminal views share: wrapping a text into lines that stand alone,
 * placing the lines that continue it, and measuring the widest unit a wrap keeps whole. Help, the
 * table, the records layout, the list, the heading, the rule, prose, and the box have to agree on
 * how text wraps and continues, so each of them reads it from here. This module belongs to no
 * subpath: help and the views each import it, and none imports another's.
 */

/** The narrowest width text wraps at, so a room that leaves less still breaks at every space. */
const NARROWEST = 1;

/** Whether a line resolves to no character at all, whatever frames it holds. */
function blank(text: string, context: ViewContext): boolean {
  return context.plain(text) === '';
}

/** A continuation line placed under the text it continues, except a blank one, which stays bare. */
function continuation(text: string, indent: string, context: ViewContext): string {
  return blank(text, context) ? text : `${indent}${text}`;
}

/**
 * The widest unit `wrap` keeps whole in a text: a word, with an input line's leading spaces on its
 * first word and its trailing spaces on its last, or a `pad` or `nowrap` frame. It reads `wrap`
 * itself at one column, so the floor and the wrap agree on every unit. A table column's floor and
 * a help row set's floor both read it.
 */
function unitWidth(text: string, context: ViewContext): number {
  return context.width(context.wrap(text, NARROWEST));
}

/**
 * A data value as the pack's views print it by default: `String(value)` escaped and styled
 * `primary`, with `null` and `undefined` printing as the empty string.
 */
function dataText(value: unknown, context: ViewContext): string {
  // `String(value)` is the documented coercion, including Object's default spelling.
  // oxlint-disable-next-line typescript/no-base-to-string
  const text = value === null || value === undefined ? '' : String(value);
  return context.style.primary(context.style.escape(text));
}

/**
 * Marked text laid out for its destination. On a terminal its tabs expand from the start of each
 * input line, then it wraps at `room` columns, and at 1 when that leaves less, or stays unwrapped
 * when `room` is undefined. Off a terminal it comes back untouched, tabs and all.
 */
function terminalWrap(text: string, context: ViewContext, room: number | undefined): string {
  if (context.columns === undefined) {
    return text;
  }
  const expanded = context.expandTabs(text);
  return room === undefined ? expanded : context.wrap(expanded, Math.max(NARROWEST, room));
}

/**
 * A block of marked text as lines that each stand alone, laid out by `terminalWrap` at the
 * context's columns less `inset`, the columns placed before it. It is split with `splitLines`
 * on and off a terminal, so a style or a hyperlink never runs into what the caller places beside
 * a line, and a trailing line break adds no line.
 */
function wrappedLines(text: string, context: ViewContext, inset: number): string[] {
  const room = context.columns === undefined ? undefined : context.columns - inset;
  return splitLines(terminalWrap(text, context, room));
}

export { NARROWEST, blank, continuation, dataText, terminalWrap, unitWidth, wrappedLines };
