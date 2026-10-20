import type { Capabilities } from './rendering.js';
import { scanAnsi } from './style-ansi.js';
import { blockWidth, isFlat, layout, renderedUnits } from './style-layout.js';
import { emptyAttributes, transition } from './style-state.js';
import type { Palette } from './style-state.js';
import { clusterColumns, graphemeWidths } from './style-width.js';
import { parseText } from './style-wire.js';

/**
 * The width of a flat text: its widest line, each line the columns of the clusters between its
 * start and its line ending, which adds none.
 */
function flatWidth(text: string): number {
  const { before } = clusterColumns(text);
  let widest = 0;
  let start = 0;
  for (let feed = text.indexOf('\n'); feed !== -1; feed = text.indexOf('\n', start)) {
    const end = text.charCodeAt(feed - 1) === 0x0d ? feed - 1 : feed;
    widest = Math.max(widest, (before[end] ?? 0) - (before[start] ?? 0));
    start = feed + 1;
  }
  return Math.max(widest, (before[text.length] ?? 0) - (before[start] ?? 0));
}

/** A complete string is one state boundary; no terminal attributes survive the call. */
function resolveText(text: string, palette: Palette, caps: Capabilities): string {
  const parsed = parseText(text, palette, caps);
  // With neither color nor modifiers to write, a flat text resolves to its characters alone.
  if (!caps.color && !caps.modifiers && isFlat(parsed)) {
    return parsed.text;
  }
  const result: string[] = [];
  let previous = emptyAttributes;
  let preservedSgr = false;
  for (const unit of renderedUnits(layout(scanAnsi(parsed, caps)))) {
    preservedSgr ||= unit.kind === 'sgr';
    // The same attributes need no transition, and most units share their neighbor's.
    if (unit.attributes !== previous) {
      result.push(transition(previous, unit.attributes, caps));
      previous = unit.attributes;
    }
    result.push(unit.text);
  }
  result.push(transition(previous, emptyAttributes, caps));
  if (preservedSgr) {
    result.push('\u001b[0m');
  }
  return result.join('');
}
function width(text: string, palette: Palette, caps: Capabilities): number {
  const parsed = parseText(text, palette, caps);
  if (isFlat(parsed)) {
    return flatWidth(parsed.text);
  }
  return blockWidth(layout(scanAnsi(parsed, caps)));
}

/**
 * Where the cursor ends after visible text written from `column` on a terminal `columns` wide: the
 * rows it moved down, and its column. A row the text fills exactly leaves the column at `columns`,
 * because the terminal wraps only when the next character arrives.
 */
function walk(visible: string, columns: number, from: number): { column: number; rows: number } {
  let rows = 0;
  let column = from;
  for (const grapheme of graphemeWidths(visible)) {
    const segmentText = visible.slice(grapheme.start, grapheme.end);
    if (segmentText.endsWith('\n')) {
      rows += 1;
      column = 0;
      continue;
    }
    if (segmentText === '\r') {
      column = 0;
      continue;
    }
    const cells =
      segmentText === '\t'
        ? Math.min(8 - (column % 8), columns - column)
        : Math.min(grapheme.width, columns);
    if (cells > 0 && column + cells > columns) {
      rows += 1;
      column = 0;
    }
    column += cells;
  }
  return { column, rows };
}

/** Counts cursor row advances, leaving a final partial line on its current row. */
function drawnRows(
  text: string,
  { palette, caps, columns }: { palette: Palette; caps: Capabilities; columns: number | undefined },
): number {
  const block = layout(scanAnsi(parseText(text, palette, caps), caps));
  if (columns === undefined || columns <= 0) {
    return block.lines.length - 1;
  }
  const visible = [...renderedUnits(block)]
    .filter((unit) => unit.kind === 'text' || (unit.kind === 'control' && unit.text === '\r'))
    .map((unit) => unit.text)
    .join('');
  return walk(visible, columns, 0).rows;
}

/**
 * The column the next character lands on after visible text written from `column`, on a terminal
 * `columns` wide, measured as `drawnRows` measures. A row the text fills exactly answers 0, because
 * the next character starts the row below. With no width, no row wraps.
 */
function nextColumn(visible: string, columns: number | undefined, column: number): number {
  const reached = walk(visible, columns === undefined || columns <= 0 ? Infinity : columns, column);
  return reached.column === columns ? 0 : reached.column;
}

export { drawnRows, nextColumn, resolveText, width };
