/*
 * A progress line's log, under ADR-0172: the lines `log()` adds, split at their line breaks, the
 * newest of them kept within the line's settings, and one unfinished line for each call still
 * reading its text. It draws nothing; the line reads its rows at each frame and its kept lines at
 * an end.
 */
import type { ViewContext } from '@loomcli/core';
import { escapeControlCharacters, glyph, style as textStyle } from '@loomcli/core';

/** The code points a line keeps before it shows the ellipsis and discards the rest. */
const LINE_LIMIT = 4096;

/** Whether text ends with the first half of a UTF-16 surrogate pair, which waits for its second half. */
function endsInHighSurrogate(text: string): boolean {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd8_00 && last <= 0xdb_ff;
}

/** One call's unfinished line, as its text arrives. */
interface Feed {
  /** The line's text so far, at most `LINE_LIMIT` code points. */
  text: string;
  /** The code points `text` holds. */
  points: number;
  /** Whether the line passed `LINE_LIMIT`, so the rest of it is discarded. */
  truncated: boolean;
  /** Whether a character other than a line break has arrived since the last line ended. */
  started: boolean;
  /** Whether a `\r` waits to learn whether a `\n` follows it. */
  carriage: boolean;
  /** A high surrogate that ended the last chunk, which waits for the next chunk's second half. */
  held: string;
  /** Whether the log stopped taking this call's text, at the line's end. */
  closed: boolean;
}

/** A line's text as it shows: its text, and the ellipsis when it passed the limit. */
function shown(feed: Feed): string {
  return feed.truncated ? feed.text + glyph.ellipsis : feed.text;
}

/** Adds one character other than a line break to an unfinished line, within the limit. */
function append(feed: Feed, character: string): void {
  if (feed.carriage) {
    // A lone `\r` that text follows starts the line over, as a child program redraws its progress.
    feed.carriage = false;
    feed.text = '';
    feed.points = 0;
    feed.truncated = false;
  }
  feed.started = true;
  if (feed.points >= LINE_LIMIT) {
    feed.truncated = true;
    return;
  }
  feed.text += character;
  feed.points += 1;
}

/**
 * The lines of one progress line's log: the newest finished lines, at most the greater of the
 * line's `logRows` and `logLimit`, the count of every finished line, and the unfinished line of
 * each call that is still reading its text.
 */
class ProgressLog {
  readonly #rows: number;
  readonly #limit: number;
  readonly #held: number;
  // The newest finished lines, a ring of at most `#held`: once full, `#next` is the oldest's index.
  readonly #lines: string[] = [];
  #next = 0;
  #finished = 0;
  readonly #open: Feed[] = [];
  #closed = false;

  constructor(rows: number, limit: number) {
    this.#rows = rows;
    this.#limit = limit;
    this.#held = Math.max(rows, limit);
  }

  /** Opens one call's unfinished line, or `undefined` once the log has closed. */
  open(): Feed | undefined {
    if (this.#closed) {
      return undefined;
    }
    const feed: Feed = {
      carriage: false,
      closed: false,
      held: '',
      points: 0,
      started: false,
      text: '',
      truncated: false,
    };
    this.#open.push(feed);
    return feed;
  }

  /** Adds one chunk of a call's text, finishing each line at its `\n`. */
  write(feed: Feed, chunk: string): void {
    if (feed.closed) {
      return;
    }
    let text = feed.held + chunk;
    feed.held = '';
    if (endsInHighSurrogate(text)) {
      feed.held = text.slice(-1);
      text = text.slice(0, -1);
    }
    for (const character of text) {
      if (character === '\n') {
        // A `\r` directly before the `\n` is part of the line break.
        feed.carriage = false;
        this.#finish(feed);
      } else if (character === '\r') {
        feed.carriage = true;
      } else {
        append(feed, character);
      }
    }
  }

  /** Ends a call's text: its held half and its unfinished line join the log, and it closes. */
  end(feed: Feed): void {
    if (feed.closed) {
      return;
    }
    if (feed.held !== '') {
      append(feed, feed.held);
      feed.held = '';
    }
    feed.carriage = false;
    if (feed.started) {
      this.#finish(feed);
    }
    feed.closed = true;
    this.#open.splice(this.#open.indexOf(feed), 1);
  }

  /** Adds a whole string's lines at once. */
  add(text: string): void {
    const feed = this.open();
    if (feed !== undefined) {
      this.write(feed, text);
      this.end(feed);
    }
  }

  /** Closes the log at the line's end: every open call's unfinished line joins it first. */
  close(): void {
    let feed = this.#open[0];
    while (feed !== undefined) {
      this.end(feed);
      feed = this.#open[0];
    }
    this.#closed = true;
  }

  /** The rows under a running line: the newest lines, then each open call's unfinished text. */
  rows(): string[] {
    if (this.#rows <= 0) {
      return [];
    }
    const unfinished = this.#open.map((feed) => shown(feed)).filter((text) => text !== '');
    return [...this.#newest(this.#rows), ...unfinished].slice(-this.#rows);
  }

  /** The lines a failed, warned, or cancelled line writes, and the count of earlier ones left out. */
  kept(): { readonly lines: readonly string[]; readonly dropped: number } {
    if (this.#limit <= 0) {
      return { dropped: 0, lines: [] };
    }
    const lines = this.#newest(this.#limit);
    return { dropped: this.#finished - lines.length, lines };
  }

  /** The newest `count` finished lines the ring holds, oldest first. */
  #newest(count: number): string[] {
    const size = this.#lines.length;
    const oldest = size < this.#held ? 0 : this.#next;
    const lines: string[] = [];
    for (let index = Math.max(0, size - count); index < size; index += 1) {
      const line = this.#lines[(oldest + index) % size];
      if (line !== undefined) {
        lines.push(line);
      }
    }
    return lines;
  }

  /** Finishes a call's unfinished line into the log, keeping only the newest lines it holds. */
  #finish(feed: Feed): void {
    const line = shown(feed);
    this.#finished += 1;
    feed.text = '';
    feed.points = 0;
    feed.truncated = false;
    feed.started = false;
    if (this.#lines.length < this.#held) {
      this.#lines.push(line);
    } else if (this.#held > 0) {
      // The ring is full, so the newest line takes the oldest's place.
      this.#lines[this.#next] = line;
      this.#next = (this.#next + 1) % this.#held;
    }
  }
}

/**
 * One log line as a row shows it, plain text on one row: the author's styles and a child program's
 * color and terminal control sequences draw nothing, `plain` drops every other control character
 * but the tab, each tab expands from the start of the line, and a line or paragraph separator or a
 * bidirectional control `plain` leaves is escaped.
 */
function logText(entry: string, context: ViewContext): string {
  const expanded = context.expandTabs(textStyle.escape(context.plain(entry)));
  return escapeControlCharacters(context.plain(expanded));
}

/** The indent of a log row and a kept line. */
const LOG_INDENT = '  ';

/** The leading parts whose widths, added up, fit `room` columns. */
function leading(parts: Iterable<string>, room: number, width: (part: string) => number): string {
  let kept = '';
  let used = 0;
  for (const part of parts) {
    used += width(part);
    if (used > room) {
      break;
    }
    kept += part;
  }
  return kept;
}

/** The graphemes of a text, read one at a time. */
function* graphemesOf(text: string): Generator<string> {
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
    text,
  )) {
    yield segment;
  }
}

/**
 * A log row that never wraps, as marked text: the indent and the text, or, while that is wider than
 * `columns`, the text's leading graphemes and the ellipsis, down to the ellipsis alone, and at 2
 * columns or fewer the leading columns of the indent and the ellipsis that fit.
 */
function logRow(entry: string, columns: number, context: ViewContext): string {
  const text = logText(entry, context);
  const width = (part: string) => context.width(textStyle.escape(part));
  if (width(LOG_INDENT + text) <= columns) {
    return textStyle.escape(LOG_INDENT + text);
  }
  const ellipsis = context.plain(glyph.ellipsis);
  const budget = columns - width(LOG_INDENT + ellipsis);
  if (budget < 0) {
    return textStyle.escape(leading(graphemesOf(LOG_INDENT + ellipsis), columns, width));
  }
  return textStyle.escape(LOG_INDENT + leading(graphemesOf(text), budget, width) + ellipsis);
}

/**
 * The view a failed, warned, or cancelled line writes its kept lines through, in place of the
 * lane's: each line of the message on a row of its own, two spaces in, dim and whole.
 */
const keptLines = {
  render: (message: string, context: ViewContext): string =>
    message
      .split('\n')
      .map((line) => context.style.dim(textStyle.escape(LOG_INDENT + logText(line, context))))
      .join('\n'),
};

export { keptLines, logRow, ProgressLog };
export type { Feed };
