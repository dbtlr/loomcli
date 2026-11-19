import { LineWalk, reopening } from '../style/lines.js';
import type { Level } from '../style/lines.js';
import type { Palette } from '../style/state.js';
import { escapeText, frame, headerEnd, open } from '../style/style.js';
import { parseText } from '../style/wire.js';
import type { FrameMark, WireTrace } from '../style/wire.js';

/*
 * What a streamed message's finished lines leave the lines after them, which the message carries
 * across its split so the lane view lays out no finished line again. Each consumer of the text a
 * lane view lays out reads a line from the state the lines before it leave open, and from nothing
 * else: line breaking and resolution read the open frames and the raw SGR attributes and hyperlink
 * set inside them, and `splitLines` opens the same frames, attributes, and hyperlink again at the
 * start of each row. A carry holds that state, read by the `LineWalk` that `splitLines` reads it
 * with, and its text is the row that sets it up, so the lines after it lay out and resolve to the
 * bytes they take in the whole text.
 */

/** The state finished lines leave the lines after them. */
interface Carry {
  /** The root, then each frame open at the split, outermost first. */
  readonly levels: readonly Level[];
  /** The OSC 8 command of the hyperlink open at the split, if one is. */
  readonly link: string | undefined;
  /**
   * An SGR command with a parameter the destination's resolution writes as it is, once the text has
   * held one. Such a command makes resolution reset every attribute at the text's end, so the carry
   * holds one too.
   */
  readonly preserved: string | undefined;
}

/** What finished lines leave the lines after them: a carry, or why the message cannot split there. */
type Carried =
  | { readonly kind: 'carry'; readonly carry: Carry }
  /**
   * A frame header or a terminal control string goes on past the lines, or the open hyperlink's
   * address holds a line break; a later split may not. A header or control string that never ends
   * keeps every later split waiting.
   */
  | { readonly kind: 'wait' }
  /**
   * The lines read differently to line breaking and resolution, under the application's palette,
   * than to `splitLines`, which accepts any token: a style names a token the palette lacks.
   */
  | { readonly kind: 'stop' };

/** The carry at a message's start, which sets nothing up. */
const emptyCarry: Carry = {
  levels: [{ header: '', scoped: true, sgr: [] }],
  link: undefined,
  preserved: undefined,
};

/**
 * The row that sets up what `carry` holds: an SGR command resolution writes as it is, inside a
 * style frame that closes at once, then the open frames, their SGR commands, and the open
 * hyperlink, as `splitLines` opens them again at a row's start.
 */
function carryText(carry: Carry): string {
  const { preserved } = carry;
  const marker = preserved === undefined ? '' : frame(['style', []], escapeText(preserved));
  return `${marker}${reopening(carry)}`;
}

/** The frames of marked text as it parses under `palette`, or under any token name. */
function framesOf(text: string, palette: Palette, anyToken: boolean) {
  const trace: Required<WireTrace> = { frames: [], origins: [], whole: [] };
  const parsed = parseText(text, palette, { anyToken, mainGlyphs: true, trace });
  return { decoded: parsed.text, trace };
}

/** Whether two frame traces open and close the same frames at the same places. */
function sameFrames(left: readonly FrameMark[], right: readonly FrameMark[]): boolean {
  return (
    left.length === right.length &&
    left.every((mark, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        mark.at === other.at &&
        mark.kind === other.kind &&
        (mark.kind === 'close' ||
          (other.kind === 'open' && mark.header === other.header && mark.scoped === other.scoped))
      );
    })
  );
}

/** Whether a frame header starts in `text` and does not end there. */
function headerOpen(text: string): boolean {
  const last = text.lastIndexOf(open);
  return last !== -1 && !text.includes(headerEnd, last);
}

/** Marked text resolved for the message's destination, as its lane view's rows are. */
type Resolve = (marked: string) => string;

/** Whether the destination writes an SGR command as it is, because it holds a parameter Loom does not track. */
function preserves(sgr: string, resolve: Resolve): boolean {
  return resolve(escapeText(sgr)) !== '';
}

/**
 * Marked text that shows the attributes each level of a carry leaves: a character after each
 * level's commands, inside that level.
 */
function probe(levels: readonly Level[]): string {
  return levels.map(({ header, sgr }) => `${header}${sgr.map(escapeText).join('')}x`).join('');
}

/**
 * Whether two carries' levels resolve alike for the destination at every level, which is all a
 * later line reads of them. Resolution writes each attribute as the destination's capabilities
 * write it, and every later command or style replaces an attribute whole or restores one a scope
 * saved, so two lists of SGR commands that resolve alike act alike on every later line. A command
 * the destination strips, such as one Loom does not track where terminal controls are stripped,
 * resolves to nothing, so it drops; one the destination writes as it is stays.
 */
function sameAttributes(
  left: readonly Level[],
  right: readonly Level[],
  resolve: Resolve,
): boolean {
  return resolve(probe(left)) === resolve(probe(right));
}

/** The levels with level `at`'s SGR commands replaced. */
function withSgr(levels: readonly Level[], at: number, sgr: string[]): Level[] {
  return levels.map((level, index) => (index === at ? { ...level, sgr } : level));
}

/**
 * The levels without level `at`'s SGR command at `index`, when dropping it leaves the attributes
 * as they were. A command the destination writes as it is stays without a probe: dropping it drops
 * its own bytes from every row it reopens, and no transition writes them.
 */
function without(
  levels: readonly Level[],
  { at, index }: { at: number; index: number },
  resolve: Resolve,
): readonly Level[] | undefined {
  const sgr = levels[at]?.sgr ?? [];
  if (preserves(sgr[index] ?? '', resolve)) {
    return undefined;
  }
  const candidate = withSgr(
    levels,
    at,
    sgr.filter((_command, other) => other !== index),
  );
  return sameAttributes(candidate, levels, resolve) ? candidate : undefined;
}

/**
 * The levels with each of level `at`'s SGR commands dropped, one at a time from the front, that
 * leaves the attributes as they were.
 */
function dropEach(levels: readonly Level[], at: number, resolve: Resolve): readonly Level[] {
  let current = levels;
  let index = 0;
  while (index < (current[at]?.sgr.length ?? 0)) {
    const dropped = without(current, { at, index }, resolve);
    if (dropped === undefined) {
      index += 1;
    } else {
      current = dropped;
    }
  }
  return current;
}

/**
 * The levels with each of level `at`'s SGR commands dropped that leaves the attributes as they
 * were, so a carry keeps a few commands however many the text has set. It tries none and the last
 * command alone first, which a text that sets one color after another reduces to.
 */
function compactLevel(levels: readonly Level[], at: number, resolve: Resolve): readonly Level[] {
  const sgr = levels[at]?.sgr ?? [];
  if (sgr.length === 0) {
    return levels;
  }
  const shortest = [[], sgr.slice(-1)].find((candidate) =>
    sameAttributes(withSgr(levels, at, candidate), levels, resolve),
  );
  return shortest === undefined ? dropEach(levels, at, resolve) : withSgr(levels, at, shortest);
}

/** The text a walk reads, decoded and traced under the application's palette. */
interface Reading {
  readonly decoded: string;
  readonly trace: Required<WireTrace>;
  /** The input offset the lines start at, after the carry's row. */
  readonly lines: number;
}

/** What the lines past the carry's row set that a carry keeps besides the open state. */
interface Fresh {
  /** Whether the lines set an SGR command, so the carry's levels are compacted. */
  sgr: boolean;
  preserved: string | undefined;
}

/** Notes an SGR command `raw` that the lines set, and keeps it if it is the first the destination writes as it is. */
function noteSgr(fresh: Fresh, raw: string, resolve: Resolve): void {
  fresh.sgr = true;
  fresh.preserved ??= preserves(raw, resolve) ? raw : undefined;
}

/**
 * Walks the carry's row and the lines after it to their last character, and answers what the
 * lines set, or undefined when a terminal control string runs on past their end.
 */
function walkLines(
  walk: LineWalk,
  { decoded, lines, trace }: Reading,
  { preserved, resolve }: { preserved: string | undefined; resolve: Resolve },
): Fresh | undefined {
  const fresh: Fresh = { preserved, sgr: false };
  for (let index = 0; index < decoded.length;) {
    const found = walk.step(index);
    if (found?.kind === 'incomplete' && found.end === decoded.length) {
      return undefined;
    }
    if (found?.kind === 'sgr' && (trace.origins[index] ?? 0) >= lines) {
      noteSgr(fresh, decoded.slice(index, found.end), resolve);
    }
    index = found?.end ?? index + 1;
  }
  return fresh;
}

/**
 * The carry the walk of the carry's row and the lines after it reaches, with its levels compacted
 * when the lines set an SGR command, or undefined when a terminal control string runs on past
 * their end.
 */
function walked(reading: Reading, { preserved }: Carry, resolve: Resolve): Carry | undefined {
  const walk = new LineWalk(reading.decoded, reading.trace.frames);
  const fresh = walkLines(walk, reading, { preserved, resolve });
  if (fresh === undefined) {
    return undefined;
  }
  walk.through(reading.decoded.length);
  const levels = fresh.sgr
    ? walk.levels.reduce<readonly Level[]>(
        (current, _level, at) => compactLevel(current, at, resolve),
        walk.levels,
      )
    : walk.levels;
  return { levels, link: walk.link, preserved: fresh.preserved };
}

/**
 * What `lines`, finished lines of a message's text that start under `outer`, leave the lines after
 * them, under the application's palette and for the destination `resolve` resolves for. A finished
 * line that holds a raw SGR command, a hyperlink, a pad or no-wrap frame, any other terminal
 * control, a header the palette rejects as a whole, or a stray close leaves its state in the carry.
 */
function carried(
  outer: Carry,
  lines: string,
  { palette, resolve }: { palette: Palette; resolve: Resolve },
): Carried {
  const before = carryText(outer);
  const text = `${before}${lines}`;
  const { decoded, trace } = framesOf(text, palette, false);
  if (!sameFrames(trace.frames, framesOf(text, new Map(), true).trace.frames)) {
    return { kind: 'stop' };
  }
  const carry = headerOpen(text)
    ? undefined
    : walked({ decoded, lines: before.length, trace }, outer, resolve);
  // A hyperlink whose address holds a line break would end the row that sets it up early.
  if (carry === undefined || /[\n\r]/u.test(carry.link ?? '')) {
    return { kind: 'wait' };
  }
  return { carry, kind: 'carry' };
}

export { carried, carryText, emptyCarry };
export type { Carried, Carry };
