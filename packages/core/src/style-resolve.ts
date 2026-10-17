import type { Capabilities } from './rendering.js';
import { scanAnsi } from './style-ansi.js';
import { blockWidth, layout, renderedUnits } from './style-layout.js';
import { emptyAttributes, transition } from './style-state.js';
import type { Palette } from './style-state.js';
import { graphemeWidths } from './style-width.js';
import { parseText } from './style-wire.js';

/** A complete string is one state boundary; no terminal attributes survive the call. */
function resolveText(text: string, palette: Palette, caps: Capabilities): string {
  const parsed = parseText(text, palette, caps);
  const result: string[] = [];
  let previous = emptyAttributes;
  let preservedSgr = false;
  for (const unit of renderedUnits(layout(scanAnsi(parsed, caps)))) {
    preservedSgr ||= unit.kind === 'sgr';
    result.push(transition(previous, unit.attributes, caps), unit.text);
    previous = unit.attributes;
  }
  result.push(transition(previous, emptyAttributes, caps));
  if (preservedSgr) {
    result.push('\u001b[0m');
  }
  return result.join('');
}
function width(text: string, palette: Palette, caps: Capabilities): number {
  const parsed = parseText(text, palette, caps);
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
