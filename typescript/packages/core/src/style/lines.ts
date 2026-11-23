import { command, hyperlinkOpens, scanAnsi } from './ansi.js';
import type { AnsiCommand } from './ansi.js';
import { isFlat, layout } from './layout.js';
import { close, escapeText, frame, textOnly } from './style.js';
import { parseText } from './wire.js';
import type { FrameMark, WireTrace } from './wire.js';
import { plainCaps } from './wrap.js';

/** One frame open at a point of the text, outermost first, with the SGR commands set inside it. */
interface Level {
  /** The frame's header as the text wrote it, or the empty string for the text's root. */
  readonly header: string;
  /** Whether the frame is a style scope; a pad or no-wrap frame is not, so its SGRs stay set around it. */
  readonly scoped: boolean;
  readonly sgr: string[];
}

/** What a point of the text leaves the text after it: the open levels and the open hyperlink. */
interface LineState {
  /** The root, then each frame open there, outermost first. */
  readonly levels: readonly Level[];
  /** The OSC 8 command of the hyperlink open there, if one is. */
  readonly link: string | undefined;
}

const hyperlinkClose = '\u001B]8;;\u001B\\';

/**
 * A walk of decoded marked text that keeps the state each point of it leaves the text after it,
 * which `splitLines` opens again at the start of each line, and which a streamed message carries
 * across its split. It is the one reading of how a line reopens: the frames that open and close
 * through a point, the raw SGR commands set inside each, and the open hyperlink.
 */
class LineWalk implements LineState {
  readonly levels: Level[] = [{ header: '', scoped: true, sgr: [] }];
  link: string | undefined = undefined;
  readonly #decoded: string;
  readonly #frames: readonly FrameMark[];
  /** How many of the frame marks the walk has applied. */
  #marked = 0;

  constructor(decoded: string, frames: readonly FrameMark[]) {
    this.#decoded = decoded;
    this.#frames = frames;
  }

  /**
   * Applies the frames that open and close through decoded offset `through`. A style frame that
   * closes takes its SGR commands with it, because its scope restores the style around it. A
   * padding or no-wrap frame is no scope, so its commands stay set in the level around it.
   */
  through(through: number): void {
    const marks = this.#frames;
    for (; this.#marked < marks.length; this.#marked += 1) {
      const mark = marks[this.#marked];
      if (mark === undefined || mark.at > through) {
        return;
      }
      if (mark.kind === 'open') {
        this.levels.push({ header: mark.header, scoped: mark.scoped, sgr: [] });
      } else if (this.levels.length > 1) {
        const ended = this.levels.pop();
        if (ended !== undefined && !ended.scoped) {
          this.levels.at(-1)?.sgr.push(...ended.sgr);
        }
      }
    }
  }

  /**
   * Takes the walk to decoded offset `index` and past the terminal control that starts there, if
   * one does, and answers that control, or undefined when a character starts there.
   */
  step(index: number): AnsiCommand | undefined {
    this.through(index);
    const found = command(this.#decoded, index);
    if (found === undefined) {
      return undefined;
    }
    this.through(found.end - 1);
    const raw = this.#decoded.slice(index, found.end);
    if (found.kind === 'sgr') {
      this.levels.at(-1)?.sgr.push(raw);
    } else if (hyperlinkOpens(found) !== undefined) {
      this.link = hyperlinkOpens(found) === true ? raw : undefined;
    }
    return found;
  }
}

/** The text that sets a line up as the open levels and the open hyperlink leave it. */
function reopening({ levels, link }: LineState): string {
  const pieces = levels.map((level) => `${level.header}${level.sgr.map(escapeText).join('')}`);
  return `${pieces.join('')}${link === undefined ? '' : escapeText(link)}`;
}

/** What a line carries in from the lines above it, and whether it sets an SGR attribute itself. */
interface Line {
  readonly walk: LineWalk;
  sgr: boolean;
}

/**
 * One finished line: the text carried in, its own input, then a close for the open hyperlink and
 * for each open frame. A line that sets an SGR attribute sits in an empty style frame, whose scope
 * ends every attribute at the line's end without a byte of its own in the output.
 */
function finished(
  { walk, sgr }: Line,
  { opening, body }: { opening: string; body: string },
): string {
  const link = walk.link === undefined ? '' : hyperlinkClose;
  const line = `${opening}${body}${link}${close.repeat(walk.levels.length - 1)}`;
  return sgr ? frame(['style', []], line) : line;
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
 *
 * @example
 * ```ts
 * import { splitLines, style } from '@loomcli/core';
 *
 * const lines = splitLines(style.red('first\nsecond'));
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/styles.md
 * @public
 */
function splitLines(text: string): string[] {
  textOnly(text);
  const trace: Required<WireTrace> = { frames: [], origins: [], whole: [] };
  const parsed = parseText(text, new Map(), { anyToken: true, mainGlyphs: true, trace });
  const decoded = parsed.text;
  const line: Line = { sgr: false, walk: new LineWalk(decoded, trace.frames) };
  const lines: string[] = [];
  let start = 0;
  let opening = '';
  /** Ends the line at input offset `end` and starts the next after the break at `after`. */
  const breakAt = (end: number, after: number): void => {
    lines.push(finished(line, { body: text.slice(start, end), opening }));
    line.walk.through(after);
    opening = reopening(line.walk);
    line.sgr = line.walk.levels.some((level) => level.sgr.length > 0);
    start = (trace.origins[after] ?? end) + 1;
  };
  for (let index = 0; index < decoded.length;) {
    const found = line.walk.step(index);
    if (found !== undefined) {
      line.sgr ||= found.kind === 'sgr';
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
  line.walk.through(decoded.length);
  if (lines.length === 0 || lastLineHasText(parsed)) {
    lines.push(finished(line, { body: text.slice(start), opening }));
  }
  return lines;
}

export { lastLineHasText, LineWalk, reopening, splitLines };
export type { Level, LineState };
