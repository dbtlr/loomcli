import { graphemeWidths as upstreamWidths } from '@rockorager/uucode/width';
import { expect, test } from 'vite-plus/test';

import { graphemeWidths } from '../src/style-width.js';
import { graphemeTable } from '../src/unicode.generated.js';

/** The highest Unicode code point. */
const lastCodePoint = 0x10_ff_ff;

/** How many consecutive code points one compared string holds. */
const runLength = 64;

/** Each grapheme's start, end, and width, as one comparable list. */
function segments(widths: Iterable<{ start: number; end: number; width: number }>) {
  return Array.from(widths, ({ end, start, width }) => [start, end, width]);
}

/**
 * Every code point in runs of consecutive code points, so each one is measured alone at the start
 * of a run and after its neighbor everywhere else. Surrogates stay in as lone code units.
 */
function* runs() {
  for (let first = 0; first <= lastCodePoint; first += runLength) {
    const codePoints = [];
    for (
      let codePoint = first;
      codePoint < first + runLength && codePoint <= lastCodePoint;
      codePoint += 1
    ) {
      codePoints.push(codePoint);
    }
    yield String.fromCodePoint(...codePoints);
  }
}

test('core measures every code point as the pinned uucode release does', () => {
  for (const text of runs()) {
    expect(segments(graphemeWidths(text))).toEqual(segments(upstreamWidths(text)));
  }
});

test.each([
  ['an emoji ZWJ sequence', '👩‍💻'],
  ['a family sequence', '👨‍👩‍👧‍👦'],
  ['a flag', '🇯🇵'],
  ['three regional indicators', '🇯🇵🇺'],
  ['a skin tone modifier', '👋🏽'],
  ['an emoji presentation selector', '☺️'],
  ['a text presentation selector', '⌚︎'],
  ['combining marks', 'é̂x'],
  ['a Devanagari conjunct', 'क्‍ष'],
  ['Hangul jamo', '각'],
  ['CRLF and controls', 'a\r\nb\u0007\u007F'],
  ['a lone high surrogate', 'a\uD800b'],
  ['a lone low surrogate', 'a\uDC00b'],
  ['a ZWJ after a non-pictograph', 'a‍💻'],
  ['a ZWJ sequence followed by text', '👩‍💻日本'],
  ['ASCII before a combining mark', 'ab́'],
  ['an empty string', ''],
])('core measures %s as the pinned uucode release does', (_name, text) => {
  expect(segments(graphemeWidths(text))).toEqual(segments(upstreamWidths(text)));
});

/** The grapheme break property of a space, and of every other character with no special rule. */
const other = 0;

test('after a character with the break property Other, the break table carries no state', () => {
  const { breakStateCount, breakTable, graphemeBreakPropertyCount: count } = graphemeTable;
  const carried: string[] = [];
  for (let state = 0; state < breakStateCount; state += 1) {
    for (let after = 0; after < count; after += 1) {
      const packed = breakTable[(state * count + other) * count + after] ?? 0;
      if (packed >> 1 !== 0) {
        carried.push(`state ${String(state)} then property ${String(after)}`);
      }
    }
  }
  expect(carried).toEqual([]);
});
