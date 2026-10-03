// Ported from the grapheme width iterator of @rockorager/uucode 2.2.1, src/width.ts.
// Copyright (c) 2026 Tim Culverhouse. Licensed under the MIT License, in licenses/uucode-LICENSE.md.
import { graphemeTable, widthTable } from './unicode.generated.js';

/** One grapheme cluster of a string: where it starts and ends, and the columns it occupies. */
interface GraphemeWidth {
  start: number;
  end: number;
  width: number;
}

/** The break state after a regional indicator, which pairs with the next one into a flag. */
const regionalIndicatorState = 1;
/** The break state inside an extended pictographic sequence, which a ZWJ continues. */
const pictographicState = 2;

/** The cursor over one string: the current code point and row, and the lookahead after them. */
interface Cursor {
  readonly text: string;
  state: number;
  index: number;
  codePoint: number;
  row: number;
  isBreak: boolean;
  hasNext: boolean;
  nextIndex: number;
  nextCodePoint: number;
  nextRow: number;
}

// The table members, read once, so each lookup indexes the arrays directly.
const { stage1, stage1Shift, stage2, stage2Mask, stage3, widthMask, zeroWidthFlag, emojiVSFlag } =
  widthTable;
const { breakTable, graphemeBreakPropertyCount } = graphemeTable;

/** A code point's packed row: its grapheme break property, width, and emoji flags. */
function lookup(codePoint: number): number {
  const offset = stage1[codePoint >> stage1Shift] ?? 0;
  return stage3[stage2[offset + (codePoint & stage2Mask)] ?? 0] ?? 0;
}

/** The row an empty string starts from: the Other break property at width one. */
const defaultRow = 1 << 5;

const graphemeBreak = (row: number) => row & 0x1f;
const rowWidth = (row: number) => (row >> 5) & widthMask;
const zeroInGrapheme = (row: number) => ((row >> 5) & zeroWidthFlag) !== 0;
const emojiSelectorBase = (row: number) => ((row >> 8) & emojiVSFlag) !== 0;

/** The next break state shifted left once, with whether a cluster boundary falls between. */
function transition(before: number, after: number, state: number): number {
  const count = graphemeBreakPropertyCount;
  return breakTable[(state * count + before) * count + after] ?? 0;
}

/** A cursor at the start of a run, with the run's first code point read ahead. */
function cursor(text: string, start: number): Cursor {
  const hasNext = start < text.length;
  const codePoint = hasNext ? (text.codePointAt(start) ?? 0) : 0;
  return {
    codePoint: 0,
    hasNext,
    index: start,
    isBreak: false,
    nextCodePoint: codePoint,
    nextIndex: hasNext ? start + (codePoint > 0xff_ff ? 2 : 1) : start,
    nextRow: hasNext ? lookup(codePoint) : defaultRow,
    row: defaultRow,
    state: 0,
    text,
  };
}

/** Moves to the next code point and reads whether a cluster boundary follows it. */
function advance(at: Cursor): boolean {
  if (!at.hasNext) {
    return false;
  }
  at.codePoint = at.nextCodePoint;
  at.row = at.nextRow;
  const index = at.nextIndex;
  at.index = index;
  if (index >= at.text.length) {
    at.hasNext = false;
    at.isBreak = true;
    return true;
  }
  const first = at.text.charCodeAt(index);
  let codePoint = first;
  let nextIndex = index + 1;
  if (first >= 0xd8_00 && first <= 0xdb_ff && nextIndex < at.text.length) {
    const second = at.text.charCodeAt(nextIndex);
    if (second >= 0xdc_00 && second <= 0xdf_ff) {
      codePoint = ((first - 0xd8_00) << 10) + second - 0xdc_00 + 0x1_00_00;
      nextIndex += 1;
    }
  }
  const row = lookup(codePoint);
  const packed = transition(graphemeBreak(at.row), graphemeBreak(row), at.state);
  at.state = packed >> 1;
  at.nextCodePoint = codePoint;
  at.nextIndex = nextIndex;
  at.nextRow = row;
  at.isBreak = (packed & 1) !== 0;
  return true;
}

/** The width of the next grapheme cluster, leaving the cursor at its end. */
function clusterWidth(at: Cursor): number {
  if (!advance(at)) {
    return 0;
  }
  const standalone = rowWidth(at.row);
  if (at.isBreak) {
    return standalone;
  }
  let width = zeroInGrapheme(at.row) ? 0 : standalone;
  let previousRow = at.row;
  let previousState = at.state;
  for (;;) {
    if (!advance(at)) {
      break;
    }
    switch (at.codePoint) {
      case 0xfe_0f: {
        if (emojiSelectorBase(previousRow)) {
          width = 2;
        }
        break;
      }
      case 0xfe_0e: {
        if (emojiSelectorBase(previousRow)) {
          width = 1;
        }
        break;
      }
      case 0x20_0d: {
        if (previousState === pictographicState && !at.isBreak) {
          if (!advance(at) || at.isBreak) {
            return width;
          }
          previousRow = at.row;
          previousState = at.state;
          continue;
        }
        break;
      }
      case 0x1_f3_fb:
      case 0x1_f3_fc:
      case 0x1_f3_fd:
      case 0x1_f3_fe:
      case 0x1_f3_ff: {
        width = 2;
        break;
      }
      default: {
        if (previousState === regionalIndicatorState) {
          width = 2;
        } else if (!zeroInGrapheme(at.row)) {
          width += rowWidth(at.row);
        }
      }
    }
    if (at.isBreak) {
      break;
    }
    previousRow = at.row;
    previousState = at.state;
  }
  return width;
}

/** Whether the character at an index is printable ASCII that no non-ASCII character follows. */
function asciiAlone(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return (
    code >= 0x20 && code < 0x7f && (index + 1 >= text.length || text.charCodeAt(index + 1) < 0x80)
  );
}

/**
 * Each grapheme cluster of a string with the terminal columns it occupies. Printable ASCII that no
 * non-ASCII character follows is its own one-column cluster. Any other run of clusters is read by
 * one cursor, which starts at the run and carries the break state from cluster to cluster.
 */
export function* graphemeWidths(text: string): Generator<GraphemeWidth> {
  let start = 0;
  while (start < text.length) {
    if (asciiAlone(text, start)) {
      yield { end: start + 1, start, width: 1 };
      start += 1;
      continue;
    }
    const at = cursor(text, start);
    do {
      const width = clusterWidth(at);
      yield { end: at.index, start, width };
      start = at.index;
    } while (start < text.length && !asciiAlone(text, start));
  }
}
