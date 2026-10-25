// Acceptance plan: see packages/core/tests/style.test.ts.

import { expect, test } from 'vite-plus/test';

import type { Capabilities } from '../src/rendering.js';
import { scanAnsi } from '../src/style-ansi.js';
import { blockWidth, isFlat, layout, renderedUnits } from '../src/style-layout.js';
import { lastLineHasText } from '../src/style-lines.js';
import { markedWidth, resolveText } from '../src/style-resolve.js';
import { emptyAttributes, transition } from '../src/style-state.js';
import { parseText } from '../src/style-wire.js';
import { plainCaps } from '../src/style-wrap.js';
import { marked, raw, seeded } from './text-corpus.js';

/**
 * A flat text, with no padding frame, command, tab, or lone CR, is measured and resolved without
 * laying it out. These tests hold that to the layout, which still serves every other text.
 */

const palette = new Map();

/** Terminals with and without color, modifiers, and controls, so resolving has styles to write. */
const destinations: readonly Capabilities[] = [
  {
    color: true,
    depth: 'truecolor',
    hyperlinks: true,
    mainGlyphs: true,
    modifiers: true,
    terminalControls: true,
  },
  {
    color: false,
    depth: 16,
    hyperlinks: false,
    mainGlyphs: false,
    modifiers: false,
    terminalControls: false,
  },
];

/** Resolving as the layout does it, for any text. */
function laidOut(text: string, caps: Capabilities): string {
  const result: string[] = [];
  let previous = emptyAttributes;
  for (const unit of renderedUnits(layout(scanAnsi(parseText(text, palette, caps), caps)))) {
    result.push(transition(previous, unit.attributes, caps), unit.text);
    previous = unit.attributes;
  }
  result.push(transition(previous, emptyAttributes, caps));
  return result.join('');
}

/** Generated texts: marked ones, with every frame, and raw ones, with every control character. */
function texts(): string[] {
  const next = seeded(98);
  return [
    ...Array.from({ length: 1500 }, () => marked(next, 3)),
    ...Array.from({ length: 1500 }, () => raw(next)),
  ];
}

test('a flat text measures as the layout measures it', () => {
  const found = texts().flatMap((text) =>
    destinations
      .filter(
        (caps) =>
          markedWidth(text, palette, caps) !==
          blockWidth(layout(scanAnsi(parseText(text, palette, caps), caps))),
      )
      .map(() => text),
  );
  expect(found).toEqual([]);
});

test('a flat text resolves as the layout resolves it', () => {
  const found = texts().filter((text) =>
    destinations.some((caps) => resolveText(text, palette, caps) !== laidOut(text, caps)),
  );
  expect(found).toEqual([]);
});

test('the generated texts hold flat and other texts both', () => {
  const flat = texts().filter((text) =>
    isFlat(parseText(text, palette, destinations[0] ?? plainCaps)),
  );
  expect(flat.length).toBeGreaterThan(300);
  expect(flat.length).toBeLessThan(2700);
});

test('a flat text ends in a line with text as the layout finds it', () => {
  const found = texts().filter((text) => {
    const parsed = parseText(text, palette, destinations[1] ?? plainCaps);
    return (
      lastLineHasText(parsed) !==
      (layout(scanAnsi(parsed, plainCaps)).lines.at(-1)?.content.text === true)
    );
  });
  expect(found).toEqual([]);
});
