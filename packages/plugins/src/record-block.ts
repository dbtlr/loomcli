import { pad, splitLines } from '@loomcli/core';
import type { ViewContext } from '@loomcli/core';

import { blank } from './text-lines.js';

type ValueAlignment = 'center' | 'left' | 'right';

/** One labelled value of a record: the label as plain marked text, and the value to lay out. */
interface RecordEntry {
  readonly align?: ValueAlignment;
  readonly label: string;
  readonly value: string;
}

const EMPTY = 0;
const FIRST = 0;
const GAP = '  ';
const HALF = 2;

/**
 * A value's lines placed within their own widest line, with no padding after any line and none
 * on a blank one.
 */
function alignLines(lines: readonly string[], align: ValueAlignment, context: ViewContext) {
  if (align === 'left') {
    return lines;
  }
  let widest = EMPTY;
  for (const text of lines) {
    widest = Math.max(widest, context.width(text));
  }
  return lines.map((text) => {
    if (blank(text, context)) {
      return text;
    }
    const room = widest - context.width(text);
    return `${' '.repeat(align === 'right' ? room : Math.floor(room / HALF))}${text}`;
  });
}

/**
 * One value's lines. Off a terminal the value is one unit with its authored breaks, as it always
 * was. On a terminal its tabs expand to spaces from the value's start, so the label column cannot
 * move a tab stop, then it wraps at `room` columns, when any are left, and every line is its own.
 */
function valueLines(entry: RecordEntry, room: number, context: ViewContext): readonly string[] {
  if (context.columns === undefined) {
    return [entry.value];
  }
  const value = context.expandTabs(entry.value);
  const wrapped = room > EMPTY ? context.wrap(value, room) : value;
  return alignLines(splitLines(wrapped), entry.align ?? 'left', context);
}

/** A continuation line of a value, indented under it, except a blank one, which stays bare. */
function continuation(text: string, indent: string, context: ViewContext): string {
  return blank(text, context) ? text : `${indent}${text}`;
}

/**
 * The first line of one entry: its label, padded to the label column, the gap, and the value's
 * first line. On a terminal a value line that resolves to no character leaves the line ending at
 * the label, unpadded and with no gap, so the line ends in no space.
 */
function labelLine(
  entry: RecordEntry,
  { context, labelWidth, text }: { context: ViewContext; labelWidth: number; text: string },
): string {
  if (context.columns !== undefined && blank(text, context)) {
    return `${context.style.dim(entry.label)}${text}`;
  }
  return `${context.style.dim(pad(entry.label, labelWidth))}${GAP}${text}`;
}

/**
 * One record as a block of `LABEL  value` lines, ending with a newline, or the empty string when
 * it has no entry. The labels pad to the widest and style `dim`. On a terminal each value wraps at
 * the columns left after the label column and its gap, every continuation line, authored or
 * wrapped, starts under the value, and a line whose value is empty ends at its label. The records
 * view and the table's fallback share this layout.
 */
function recordBlock(entries: readonly RecordEntry[], context: ViewContext): string {
  if (entries.length === EMPTY) {
    return '';
  }
  let labelWidth = EMPTY;
  for (const entry of entries) {
    labelWidth = Math.max(labelWidth, context.width(entry.label));
  }
  const indent = ' '.repeat(labelWidth + GAP.length);
  const room = (context.columns ?? EMPTY) - labelWidth - GAP.length;
  const lines = entries.flatMap((entry) =>
    valueLines(entry, room, context).map((text, index) =>
      index === FIRST
        ? labelLine(entry, { context, labelWidth, text })
        : continuation(text, indent, context),
    ),
  );
  return `${lines.join('\n')}\n`;
}

export { recordBlock };
export type { RecordEntry, ValueAlignment };
