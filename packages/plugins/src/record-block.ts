import { pad } from '@loomcli/core';
import type { ViewContext } from '@loomcli/core';

import { splitMarkedLines } from './marked-lines.js';

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

/** A value's lines placed within their own widest line, with no padding after any line. */
function alignLines(lines: readonly string[], align: ValueAlignment, context: ViewContext) {
  if (align === 'left') {
    return lines;
  }
  let widest = EMPTY;
  for (const text of lines) {
    widest = Math.max(widest, context.width(text));
  }
  return lines.map((text) => {
    const room = widest - context.width(text);
    return `${' '.repeat(align === 'right' ? room : Math.floor(room / HALF))}${text}`;
  });
}

/**
 * One value's lines. Off a terminal the value is one unit with its authored breaks, as it always
 * was. On a terminal it wraps at `room` columns, when any are left, and every line is its own.
 */
function valueLines(entry: RecordEntry, room: number, context: ViewContext): readonly string[] {
  if (context.columns === undefined) {
    return [entry.value];
  }
  const wrapped = room > EMPTY ? context.wrap(entry.value, room) : entry.value;
  return alignLines(splitMarkedLines(wrapped), entry.align ?? 'left', context);
}

/** A continuation line of a value, indented under it, except a blank one. */
function continuation(text: string, indent: string): string {
  return text === '' ? text : `${indent}${text}`;
}

/**
 * One record as a block of `LABEL  value` lines, ending with a newline, or the empty string when
 * it has no entry. The labels pad to the widest and style `dim`. On a terminal each value wraps at
 * the columns left after the label column and its gap, and every continuation line, authored or
 * wrapped, starts under the value. The records view and the table's fallback share this layout.
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
  const lines = entries.flatMap((entry) => {
    const label = context.style.dim(pad(entry.label, labelWidth));
    return valueLines(entry, room, context).map((text, index) =>
      index === FIRST ? `${label}${GAP}${text}` : continuation(text, indent),
    );
  });
  return `${lines.join('\n')}\n`;
}

export { recordBlock };
export type { RecordEntry, ValueAlignment };
