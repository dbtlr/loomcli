import type { Capabilities } from './rendering.js';
import { scanAnsi } from './style-ansi.js';
import { blockWidth, layout, renderedUnits } from './style-layout.js';
import { emptyAttributes, transition } from './style-state.js';
import type { Palette } from './style-state.js';
import { graphemeWidths } from './style-width.js';
import { isFlat, parseText } from './style-wire.js';

/**
 * The width of a flat text: its widest line, each line the sum of its clusters. A line ending
 * ends a line and adds no columns.
 */
function flatWidth(text: string): number {
  let widest = 0;
  let line = 0;
  for (const cluster of graphemeWidths(text)) {
    const code = text.charCodeAt(cluster.start);
    if (code === 0x0a || code === 0x0d) {
      widest = Math.max(widest, line);
      line = 0;
    } else {
      line += cluster.width;
    }
  }
  return Math.max(widest, line);
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
  let rows = 0;
  let column = 0;
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
  return rows;
}

export { drawnRows, resolveText, width };
