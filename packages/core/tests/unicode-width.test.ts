import { graphemeWidths as upstreamWidths } from '@rockorager/uucode/width';
import { expect, test } from 'vite-plus/test';

import { graphemeWidths } from '../src/style-width.js';

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

/** Code points that join, pair, or carry break state, drawn from every grapheme break property. */
const stateful = [
  0x20, 0x61, 0x07, 0x0d, 0x0a, 0x6_00, 0x9_03, 0x11_00, 0x11_60, 0x11_a8, 0xac_00, 0xac_01,
  0x20_0c, 0x20_0d, 0x27_64, 0xfe_0f, 0x3_01, 0x9_15, 0x9_37, 0x9_4d, 0xd_15, 0xd_4d, 0x4f_60,
  0x1_f6_00, 0x1_f4_4d, 0x1_f3_fd, 0x1_f1_fa, 0x1_f1_f8, 0x1_f1_ec,
];

/** Texts of one to ten of those code points, from a seeded generator. */
function* statefulTexts() {
  let state = 17;
  const next = (below: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % below;
  };
  for (let count = 0; count < 20_000; count += 1) {
    yield String.fromCodePoint(
      ...Array.from({ length: 1 + next(10) }, () => stateful[next(stateful.length)] ?? 0),
    );
  }
}

/** Each text whose fresh clusters do not start a reading that gives the same clusters after them. */
function disagreements() {
  const found: string[] = [];
  for (const text of statefulTexts()) {
    const whole = [...graphemeWidths(text)];
    for (const cluster of whole.filter((each) => each.fresh)) {
      const after = segments(whole.filter((each) => each.start >= cluster.start)).map(
        ([start = 0, end = 0, width]) => [start - cluster.start, end - cluster.start, width],
      );
      if (
        JSON.stringify(segments(graphemeWidths(text.slice(cluster.start)))) !==
        JSON.stringify(after)
      ) {
        found.push(text);
      }
    }
  }
  return found;
}

test('a cluster read as fresh starts a reading that gives the same clusters from there on', () => {
  expect(disagreements()).toEqual([]);
});
