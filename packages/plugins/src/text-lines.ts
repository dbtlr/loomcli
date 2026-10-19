import { glyph, pad, splitLines } from '@loomcli/core';
import type { ViewContext } from '@loomcli/core';

/**
 * The line layout the pack's terminal views share: wrapping a text into lines that stand alone,
 * placing the lines that continue it, measuring the widest unit a wrap keeps whole, and the marker
 * column and underline that make a list and a heading look the same wherever they print. Help, the
 * table, the records layout, the list, the heading, the rule, prose, and the box have to agree on
 * how text wraps and continues, so each of them reads it from here. This module belongs to no
 * subpath: help and the views each import it, and none imports another's.
 */

/** The narrowest width text wraps at, so a room that leaves less still breaks at every space. */
const NARROWEST = 1;

/** The space between a list marker and its item's text. */
const MARKER_GAP = ' ';

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

/** The markers of one level of list siblings, and where their items' text starts. */
interface ItemMarkers {
  /** Each item's marker, right-aligned to the widest marker and styled `dim`. */
  readonly marks: readonly string[];
  /** The columns from a marker's start to its item's text: the widest marker and the gap. */
  readonly textOffset: number;
}

/** Each sibling's label: a bullet, or its number counting up from `start` and a period. */
function markerLabels(count: number, start: number | undefined): string[] {
  return Array.from({ length: count }, (_unused, index) =>
    start === undefined ? glyph.bullet : `${String(start + index)}.`,
  );
}

/**
 * The markers of `count` list siblings, bullets when `start` is undefined and numbers counting up
 * from `start` otherwise. They right-align to the widest among the siblings, so every item's text
 * starts in one column, and print `dim`.
 */
function itemMarkers(count: number, start: number | undefined, context: ViewContext): ItemMarkers {
  const labels = markerLabels(count, start);
  const width = context.width(labels.join('\n'));
  return {
    marks: labels.map((label) => context.style.dim(pad(label, width, { align: 'right' }))),
    textOffset: width + MARKER_GAP.length,
  };
}

/** An item's first line after its marker, or the marker alone when the line has no character. */
function markedLine(mark: string, first: string, context: ViewContext): string {
  return blank(first, context) ? mark : `${mark}${MARKER_GAP}${first}`;
}

/**
 * A heading's wrapped lines styled `dim`. An underlined heading, level 1, adds a line of
 * `glyph.line` as wide as the widest of the lines, and any other heading is the lines alone.
 */
function headingLines(
  lines: readonly string[],
  underlined: boolean,
  context: ViewContext,
): string[] {
  const written = lines.map((line) => context.style.dim(line));
  const widest = context.width(lines.join('\n'));
  return underlined ? [...written, context.style.dim(glyph.line.repeat(widest))] : written;
}

export {
  NARROWEST,
  blank,
  continuation,
  dataText,
  headingLines,
  itemMarkers,
  markedLine,
  terminalWrap,
  unitWidth,
  wrappedLines,
};
export type { ItemMarkers };
