import type { Capabilities } from './rendering.js';
import { command, scanAnsi } from './style-ansi.js';
import { blockWidth, layout, tabAdvances } from './style-layout.js';
import { emptyAttributes } from './style-state.js';
import type { Palette } from './style-state.js';
import { graphemeWidths } from './style-width.js';
import { parseText } from './style-wire.js';
import type { Boundary, ParsedText, WireTrace } from './style-wire.js';
import { textOnly } from './style.js';

/** One input line of decoded text: its content, without the line ending, and that ending. */
interface Line {
  start: number;
  end: number;
  crlf: boolean;
}

/** A break opportunity: the spaces between two words, with any zero-width command among them. */
interface Run {
  start: number;
  end: number;
  spaces: readonly number[];
}

/** One text as line breaking reads it: decoded, traced to its input, and its commands marked. */
interface Breakable {
  parsed: ParsedText;
  trace: WireTrace;
  commands: readonly boolean[];
  caps: Capabilities;
}

/** Each decoded character inside an ANSI command, found the way the ANSI scanner finds them. */
function commandCharacters(text: string): boolean[] {
  const inside: boolean[] = [];
  inside.length = text.length;
  inside.fill(false);
  for (let cursor = 0; cursor < text.length;) {
    const found = command(text, cursor);
    if (found === undefined) {
      cursor += 1;
      continue;
    }
    inside.fill(true, cursor, found.end);
    cursor = found.end;
  }
  return inside;
}

/** The input lines: each LF outside a command ends one, and a CR before it makes it CRLF. */
function linesOf({ parsed, commands }: Breakable): Line[] {
  const { text } = parsed;
  const lines: Line[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' && !commands[index]) {
      const crlf = index > start && text[index - 1] === '\r';
      lines.push({ crlf, end: crlf ? index - 1 : index, start });
      start = index + 1;
    }
  }
  lines.push({ crlf: false, end: text.length, start });
  return lines;
}

/** A U+0020 that line breaking may break at: literal, outside every whole frame and command. */
function breakSpace(text: Breakable, index: number): boolean {
  return (
    text.parsed.text[index] === ' ' && !text.trace.whole[index] && text.commands[index] !== true
  );
}

/**
 * The break opportunities of one line. A line's leading spaces stay with its first word and its
 * trailing spaces stay with its last word, so neither is a run, and both count toward the fit.
 */
function runsOf(text: Breakable, line: Line): Run[] {
  const runs: Run[] = [];
  let seen = false;
  let open: number[] | undefined = undefined;
  for (let index = line.start; index < line.end; index += 1) {
    if (breakSpace(text, index)) {
      open ??= [];
      open.push(index);
    } else if (!text.commands[index]) {
      if (open !== undefined && seen) {
        runs.push({ end: (open.at(-1) ?? index) + 1, spaces: open, start: open[0] ?? index });
      }
      open = undefined;
      seen = true;
    }
  }
  return runs;
}

/** The padding frames open before each line start, read once from the start of the text. */
function padTracker(parsed: ParsedText): (index: number) => Boundary[] {
  const open: Boundary[] = [];
  let walked = 0;
  return (index) => {
    for (; walked < index; walked += 1) {
      for (const boundary of parsed.boundaries.get(walked) ?? []) {
        if (boundary.kind === 'open') {
          open.push(boundary);
        } else {
          open.pop();
        }
      }
    }
    return [...open];
  };
}

/** A span of one line, as `measure` takes it. */
interface Span {
  start: number;
  end: number;
  enclosing: readonly Boundary[];
}

/**
 * The width of decoded characters `start` to `end` laid out as one line, as `width()` measures
 * them. The padding frames `enclosing` names reopen at `start`, and any still open close at `end`.
 * It lays the span out afresh, so it reads every character of it. `Measurer` reads a span of a
 * plain line from one reading of the whole line instead.
 */
function measure(text: Breakable, { start, end, enclosing }: Span): number {
  const { parsed } = text;
  const boundaries = new Map<number, Boundary[]>();
  let depth = enclosing.length;
  const opening = [...enclosing];
  for (let at = start; at <= end; at += 1) {
    const here = at === start ? opening : [];
    for (const boundary of parsed.boundaries.get(at) ?? []) {
      depth += boundary.kind === 'open' ? 1 : -1;
      here.push(boundary);
    }
    if (at === end) {
      for (; depth > 0; depth -= 1) {
        here.push({ kind: 'close' });
      }
    }
    if (here.length > 0) {
      boundaries.set(at - start, here);
    }
  }
  const slice: ParsedText = {
    boundaries,
    palette: parsed.palette,
    root: parsed.root,
    scopes: parsed.scopes.slice(start, end),
    text: parsed.text.slice(start, end),
  };
  return blockWidth(layout(scanAnsi(slice, text.caps)));
}

/** The decoded text without its ANSI commands, which is all the width of a plain line reads. */
interface Visible {
  text: string;
  /** For each decoded index, and one past the last, how many visible characters precede it. */
  before: Int32Array;
}

/** The visible characters of a text, and where each decoded index falls among them. */
function visibleOf({ parsed, commands }: Breakable): Visible {
  const before = new Int32Array(parsed.text.length + 1);
  const pieces: string[] = [];
  let count = 0;
  let from = 0;
  for (let index = 0; index < parsed.text.length; index += 1) {
    before[index] = count;
    if (commands[index] === true) {
      pieces.push(parsed.text.slice(from, index));
      from = index + 1;
    } else {
      count += 1;
    }
  }
  before[parsed.text.length] = count;
  pieces.push(parsed.text.slice(from));
  return { before, text: pieces.length === 1 ? parsed.text : pieces.join('') };
}

/** How a visible position relates to the clusters of its line. */
const withinCluster = 0;
const atBoundary = 1;
const atFreshBoundary = 2;

/**
 * The clusters of one line's visible characters, read once. `columns[position]` is the width of
 * every cluster before a boundary, and `marks[position]` says whether the position is inside a
 * cluster, a boundary between clusters, or a boundary at which a reading begun there agrees with
 * this one from there on.
 */
interface Clusters {
  columns: Int32Array;
  marks: Uint8Array;
}

function clustersOf(visible: string): Clusters {
  const columns = new Int32Array(visible.length + 1);
  const marks = new Uint8Array(visible.length + 1);
  let total = 0;
  for (const cluster of graphemeWidths(visible)) {
    columns[cluster.start] = total;
    marks[cluster.start] = cluster.fresh ? atFreshBoundary : atBoundary;
    total += cluster.width;
  }
  columns[visible.length] = total;
  marks[visible.length] = atBoundary;
  return { columns, marks };
}

/** Whether a sorted list holds a number from `low` to `high`, both included. */
function holdsBetween(sorted: readonly number[], low: number, high: number): boolean {
  let start = 0;
  let end = sorted.length;
  while (start < end) {
    const middle = (start + end) >> 1;
    if ((sorted[middle] ?? 0) < low) {
      start = middle + 1;
    } else {
      end = middle;
    }
  }
  const found = sorted[start];
  return found !== undefined && found <= high;
}

/** The widths of the spans of one line, which `breaks` asks for one word at a time. */
type Measurer = (span: Span) => number;

/**
 * A measurer for one line. A line with no padding frame at, within, or around it and no tab
 * measures as the sum of the widths of its clusters, so its measurer reads the line once and
 * answers a span from those widths. That holds for a span whose start and end are cluster
 * boundaries and whose start is one a reading begun there agrees with the whole reading from. A
 * span of any other kind, and any other line, is laid out as `measure` does.
 */
function measurerFor(
  text: Breakable,
  line: Line,
  {
    enclosing,
    frames,
    visible,
  }: { enclosing: readonly Boundary[]; frames: readonly number[]; visible: Visible },
): Measurer {
  const exact: Measurer = (span) => measure(text, span);
  const first = visible.before[line.start] ?? 0;
  const last = visible.before[line.end] ?? 0;
  const own = visible.text.slice(first, last);
  if (enclosing.length > 0 || holdsBetween(frames, line.start, line.end) || own.includes('\t')) {
    return exact;
  }
  const { columns, marks } = clustersOf(own);
  return (span) => {
    const from = (visible.before[span.start] ?? 0) - first;
    const to = (visible.before[span.end] ?? 0) - first;
    if (marks[from] !== atFreshBoundary || marks[to] === withinCluster) {
      return exact(span);
    }
    return (columns[to] ?? 0) - (columns[from] ?? 0);
  };
}

/**
 * Where greedy fitting breaks one text: each run it breaks at, mapped from the input offset of
 * each of its spaces to what replaces it, the line break for the first and nothing for the rest.
 */
function breaks(text: Breakable, columns: number): Map<number, string> {
  const edits = new Map<number, string>();
  const enclosingPads = padTracker(text.parsed);
  // Decoding adds a boundary at the end of the text so far, so the keys arrive in ascending order.
  const frames = [...text.parsed.boundaries.keys()];
  let visible: Visible | undefined = undefined;
  for (const line of linesOf(text)) {
    const runs = runsOf(text, line);
    if (runs.length === 0) {
      continue;
    }
    const enclosing = enclosingPads(line.start);
    visible ??= visibleOf(text);
    const widthOf = measurerFor(text, line, { enclosing, frames, visible });
    if (widthOf({ enclosing, end: line.end, start: line.start }) <= columns) {
      continue;
    }
    let from = line.start;
    for (const [index, run] of runs.entries()) {
      const next = runs[index + 1]?.start ?? line.end;
      const span = { enclosing: from === line.start ? enclosing : [], end: next, start: from };
      if (widthOf(span) <= columns) {
        continue;
      }
      for (const [position, space] of run.spaces.entries()) {
        const origin = text.trace.origins[space] ?? space;
        edits.set(origin, position === 0 ? (line.crlf ? '\r\n' : '\n') : '');
      }
      from = run.end;
    }
  }
  return edits;
}

/**
 * The input with each edited offset replaced, every other unit kept as it was. Decoding reads the
 * input in order, so the edits arrive in ascending offset order.
 */
function edited(input: string, edits: Map<number, string>): string {
  if (edits.size === 0) {
    return input;
  }
  const pieces: string[] = [];
  let from = 0;
  for (const [offset, replacement] of edits) {
    pieces.push(input.slice(from, offset), replacement);
    from = offset + 1;
  }
  pieces.push(input.slice(from));
  return pieces.join('');
}

/** A width argument of `wrap`: a positive safe integer. */
function wrapWidth(columns: number): number {
  if (!Number.isSafeInteger(columns) || columns <= 0) {
    throw new RangeError('Wrap width must be a positive safe integer.');
  }
  return columns;
}

/**
 * Marked text with line breaks inserted so each line fits `columns`, measured with the
 * destination's glyph forms as `width()` measures. Breaks fall at U+0020 alone, a word wider than
 * `columns` keeps a line of its own, a padding or no-wrap frame is one unit, and an undefined
 * `columns` returns the text unchanged.
 */
function wrapMarked(
  text: string,
  columns: number | undefined,
  { caps, palette }: { caps: Capabilities; palette: Palette },
): string {
  textOnly(text);
  if (columns === undefined) {
    return text;
  }
  const width = wrapWidth(columns);
  const trace: WireTrace = { origins: [], whole: [] };
  const parsed = parseText(text, palette, { mainGlyphs: caps.mainGlyphs, trace });
  return edited(
    text,
    breaks({ caps, commands: commandCharacters(parsed.text), parsed, trace }, width),
  );
}

/**
 * Marked text with each tab replaced by the spaces that reach the next multiple of eight, counted
 * from the start of its input line as `width()` counts it, so text placed at any offset shows as
 * it measures. Frame headers, escapes, and ANSI commands keep their bytes, and a tab inside a
 * style or no-wrap frame expands as any other. A tab inside a padding frame is left to the frame,
 * which already resolves it to spaces from the frame's own start.
 */
function expandTabsMarked(
  text: string,
  { caps, palette }: { caps: Capabilities; palette: Palette },
): string {
  textOnly(text);
  if (!text.includes('\t')) {
    return text;
  }
  const trace: WireTrace = { origins: [], whole: [] };
  const parsed = parseText(text, palette, { mainGlyphs: caps.mainGlyphs, trace });
  const advances = tabAdvances(layout(scanAnsi(parsed, caps)));
  const commands = commandCharacters(parsed.text);
  const edits = new Map<number, string>();
  let padding = 0;
  let next = 0;
  for (let index = 0; index < parsed.text.length; index += 1) {
    for (const boundary of parsed.boundaries.get(index) ?? []) {
      padding += boundary.kind === 'open' ? 1 : -1;
    }
    if (parsed.text[index] !== '\t' || commands[index] === true || padding > 0) {
      continue;
    }
    const advance = advances[next];
    next += 1;
    if (advance !== undefined) {
      edits.set(trace.origins[index] ?? index, ' '.repeat(advance));
    }
  }
  return edited(text, edits);
}

/** The capabilities plain text is measured under: no glyph frame, style, or command applies. */
const plainCaps: Capabilities = {
  color: false,
  depth: 16,
  hyperlinks: false,
  mainGlyphs: true,
  modifiers: false,
  terminalControls: false,
};

/**
 * Plain text, read as literal characters rather than marked text, with line breaks inserted by
 * the same rules as `wrapMarked`, measured in terminal display columns.
 */
function wrapPlain(text: string, columns: number): string {
  const width = wrapWidth(columns);
  const root = { attributes: emptyAttributes, operations: [], parent: undefined };
  const parsed: ParsedText = {
    boundaries: new Map(),
    palette: new Map(),
    root,
    scopes: Array.from({ length: text.length }, () => root),
    text,
  };
  const trace: WireTrace = {
    origins: Array.from({ length: text.length }, (_unit, index) => index),
    whole: Array.from({ length: text.length }, () => false),
  };
  const commands = commandCharacters(text);
  return edited(text, breaks({ caps: plainCaps, commands, parsed, trace }, width));
}

export { expandTabsMarked, plainCaps, wrapMarked, wrapPlain };
