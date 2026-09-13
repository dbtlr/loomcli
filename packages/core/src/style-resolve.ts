import type { Capabilities } from './rendering.js';
import { scanAnsi } from './style-ansi.js';
import { blockWidth, layout, renderedUnits } from './style-layout.js';
import { emptyAttributes, transition } from './style-state.js';
import type { Palette } from './style-state.js';
import { parseText } from './style-wire.js';

/** A complete string is one state boundary; no terminal attributes survive the call. */
function resolveText(text: string, palette: Palette, caps: Capabilities): string {
  const parsed = parseText(text, palette, caps.mainGlyphs);
  const result: string[] = [];
  let previous = emptyAttributes;
  for (const unit of renderedUnits(layout(scanAnsi(parsed, caps)))) {
    result.push(transition(previous, unit.attributes, caps), unit.text);
    previous = unit.attributes;
  }
  result.push(transition(previous, emptyAttributes, caps));
  return result.join('');
}
function width(text: string, palette: Palette, caps: Capabilities): number {
  const parsed = parseText(text, palette, caps.mainGlyphs);
  return blockWidth(layout(scanAnsi(parsed, caps)));
}

export { resolveText, width };
