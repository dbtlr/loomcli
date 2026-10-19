import { command, hyperlinkOpens, scanAnsi } from './style-ansi.js';
import { layout } from './style-layout.js';
import { isFlat, parseText } from './style-wire.js';
import type { FrameMark, WireTrace } from './style-wire.js';
import { plainCaps } from './style-wrap.js';
import { close, escapeText, frame, textOnly } from './style.js';

/** One frame open at a point of the text, outermost first, with the SGR commands set inside it. */
interface Level {
  readonly header: string;
  readonly scoped: boolean;
  readonly sgr: string[];
}

/** What a line carries in from the lines above it, and what it sets itself. */
interface State {
  readonly levels: Level[];
  link: string | undefined;
  sgr: boolean;
}

const hyperlinkClose = '\u001B]8;;\u001B\\';

/**
 * The frames that open and close through `through`, applied to the open levels. A style frame
 * that closes takes its SGR commands with it, because its scope restores the style around it. A
 * padding or no-wrap frame is no scope, so its commands stay set in the level around it.
 */
function applyMarks(
  state: State,
  marks: readonly FrameMark[],
  { from, through }: { from: number; through: number },
): number {
  let next = from;
  for (; next < marks.length && (marks[next]?.at ?? Infinity) <= through; next += 1) {
    const mark = marks[next];
    if (mark?.kind === 'open') {
      state.levels.push({ header: mark.header, scoped: mark.scoped, sgr: [] });
    } else if (state.levels.length > 1) {
      const ended = state.levels.pop();
      if (ended !== undefined && !ended.scoped) {
        state.levels.at(-1)?.sgr.push(...ended.sgr);
      }
    }
  }
  return next;
}

/** The text that sets a line up as the open levels and the open hyperlink leave it. */
function reopening({ levels, link }: State): string {
  const pieces = levels.map((level) => `${level.header}${level.sgr.map(escapeText).join('')}`);
  return `${pieces.join('')}${link === undefined ? '' : escapeText(link)}`;
}

/**
 * One finished line: the text carried in, its own input, then a close for the open hyperlink and
 * for each open frame. A line that sets an SGR attribute sits in an empty style frame, whose scope
 * ends every attribute at the line's end without a byte of its own in the output.
 */
function finished(state: State, { opening, body }: { opening: string; body: string }): string {
  const link = state.link === undefined ? '' : hyperlinkClose;
  const line = `${opening}${body}${link}${close.repeat(state.levels.length - 1)}`;
  return state.sgr ? frame(['style', []], line) : line;
}

/** Whether the last line of decoded text resolves to any character, as padding counts lines. */
function lastLineHasText(parsed: ReturnType<typeof parseText>): boolean {
  if (isFlat(parsed)) {
    return parsed.text.length > 0 && !parsed.text.endsWith('\n');
  }
  return layout(scanAnsi(parsed, plainCaps)).lines.at(-1)?.content.text === true;
}

/**
 * Marked text split at its line breaks, LF and CRLF, into lines that each stand alone. Every Loom
 * frame, embedded SGR attribute, and embedded OSC 8 hyperlink open at a line's end closes there and
 * opens again at the start of the next line, so a caller can place lines side by side and nothing
 * leaks from one onto another. A trailing line break ends the last line and adds no empty one, as
 * `pad` adds no padded line after it, and text without a break comes back as one line.
 */
function splitLines(text: string): string[] {
  textOnly(text);
  const trace: Required<WireTrace> = { frames: [], origins: [], whole: [] };
  const parsed = parseText(text, new Map(), { anyToken: true, mainGlyphs: true, trace });
  const decoded = parsed.text;
  const state: State = {
    levels: [{ header: '', scoped: true, sgr: [] }],
    link: undefined,
    sgr: false,
  };
  const lines: string[] = [];
  let marked = 0;
  let start = 0;
  let opening = '';
  /** Ends the line at input offset `end` and starts the next after the break at `after`. */
  const breakAt = (end: number, after: number): void => {
    lines.push(finished(state, { body: text.slice(start, end), opening }));
    marked = applyMarks(state, trace.frames, { from: marked, through: after });
    opening = reopening(state);
    state.sgr = state.levels.some((level) => level.sgr.length > 0);
    start = (trace.origins[after] ?? end) + 1;
  };
  for (let index = 0; index < decoded.length;) {
    marked = applyMarks(state, trace.frames, { from: marked, through: index });
    const found = command(decoded, index);
    if (found !== undefined) {
      marked = applyMarks(state, trace.frames, { from: marked, through: found.end - 1 });
      const raw = decoded.slice(index, found.end);
      if (found.kind === 'sgr') {
        state.levels.at(-1)?.sgr.push(raw);
        state.sgr = true;
      } else if (hyperlinkOpens(found) !== undefined) {
        state.link = hyperlinkOpens(found) === true ? raw : undefined;
      }
      index = found.end;
    } else if (decoded[index] === '\r' && decoded[index + 1] === '\n') {
      breakAt(trace.origins[index] ?? text.length, index + 1);
      index += 2;
    } else if (decoded[index] === '\n') {
      breakAt(trace.origins[index] ?? text.length, index);
      index += 1;
    } else {
      index += 1;
    }
  }
  marked = applyMarks(state, trace.frames, { from: marked, through: decoded.length });
  if (lines.length === 0 || lastLineHasText(parsed)) {
    lines.push(finished(state, { body: text.slice(start), opening }));
  }
  return lines;
}

export { lastLineHasText, splitLines };
