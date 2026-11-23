import { command, hyperlinkOpens } from '../style/ansi.js';
import { splitLines } from '../style/lines.js';
import type { Palette } from '../style/state.js';
import { close, escapeText } from '../style/style.js';
import { parseText } from '../style/wire.js';
import type { WireTrace } from '../style/wire.js';
import { handled } from '../support/thenable.js';
import { carried, carryText, emptyCarry } from './carry.js';
import type { Carry } from './carry.js';
import { completeLines } from './complete-lines.js';
import { controlSequences, endsWithLineBreak, visible } from './region.js';
import type { Frame } from './region.js';

/*
 * One streamed message: a semantic method's text read from an async iterable, laid out through its
 * lane view as each chunk arrives. Off a terminal it is written a completed line at a time. On a
 * terminal that redraws, a lane that wraps writes every row the text finishes for good and keeps
 * its last row as the unfinished row, which the screen redraws above the live regions, and `print`
 * writes what each chunk adds at the cursor and never redraws any of it. Once the iterable ends,
 * what was written is what the method writes for the joined text.
 */

/** What one write does to the message's unfinished row: sets it, or takes it off the screen. */
type RowChange =
  | { readonly kind: 'set'; readonly frame: Frame | undefined }
  | { readonly kind: 'drop' };

/** The change that takes a message's unfinished row off the screen, at its end. */
const dropped: RowChange = { kind: 'drop' };

/**
 * One write a streamed message makes: the text written for good, its unfinished row's change, and
 * for a `print` that grows at the cursor, whether its line is still unfinished after the text.
 */
interface Piece {
  readonly text: string;
  /** Absent off a terminal and for `print`, where a message keeps no unfinished row. */
  readonly row?: RowChange | undefined;
  /** Present for a `print` on a terminal that redraws: true while the text leaves its line unfinished. */
  readonly open?: boolean | undefined;
}

/**
 * How a message lays out on a terminal that redraws: a lane that wraps keeps an unfinished row the
 * screen redraws while `fits` answers that the row fits on the screen, and `print` grows its line
 * at the cursor while `appends` answers true, read at the start of each line, and writes a whole
 * line at a time otherwise.
 */
type TerminalLayout =
  | { readonly kind: 'rows'; fits: (frame: Frame) => boolean }
  | { readonly kind: 'append'; appends: () => boolean };

/** What one streamed message draws through and writes to, supplied by the output that issued it. */
interface MessageSink {
  /** Whether the run's verbosity hides the message, which is then read to its end and never laid out. */
  hidden: boolean;
  /**
   * Whether the lane view is the one core ships, which lays out each line apart from the lines
   * before it, so a line the message has finished is never laid out again. An overridden view is
   * a function of the whole message, which is laid out whole at every chunk.
   */
  partial: boolean;
  /** The application's palette, whose tokens a style in the message may name. */
  palette: () => Palette;
  /** The lane view's marked text for the text so far, under one context the message keeps. */
  render: (text: string) => string;
  /** Marked text resolved for the message's destination. */
  resolve: (marked: string) => string;
  /** On a terminal that redraws, how the message lays out there. Absent elsewhere, where it writes whole lines. */
  terminal: TerminalLayout | undefined;
  /** Queues one write on the message's destination. */
  write: (piece: Piece) => Promise<void>;
  /** Records a failure the iterable or the lane view raised, which the call rejects with. */
  raise: (cause: unknown) => void;
}

/** The characters a trailing run the message holds back is made of. */
const heldSpaces = new Set([' ', '\t', '\r']);

/** A high surrogate, the first half of a character outside the BMP, read as one code unit. */
const highSurrogate = /^[\uD800-\uDBFF]$/u;

/**
 * The text so far without what it ends with and the message does not lay out yet, keeping the
 * frame closes after it: a trailing run of spaces, tabs, and carriage returns, and a high surrogate
 * whose low surrogate has not arrived. The lane views break a row at a space, so a space that ends
 * the text so far can move the word before it to the next row, which the text that follows it may
 * move back; a carriage return waits to learn whether a line feed follows it; and half a character
 * written alone reaches a terminal as a replacement character, which a `print` never redraws. Each
 * shows once text after it arrives or the message ends.
 *
 * It reads back from the end and stops at the first character it keeps, so its work is the length
 * of what it holds and the closes after it, however long a run of spaces inside the text is.
 */
function withoutTrailingHeld(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === close) {
    end -= 1;
  }
  let start = end;
  if (start > 0 && highSurrogate.test(text[start - 1] ?? '')) {
    start -= 1;
  }
  while (start > 0 && heldSpaces.has(text[start - 1] ?? '')) {
    start -= 1;
  }
  return start === end ? text : `${text.slice(0, start)}${text.slice(end)}`;
}

/**
 * The decoded offset of the escape sequence that ends decoded text without being finished: a lone
 * ESC, or a CSI, an OSC, or another control string still waiting for its final byte or
 * terminator. Undefined when the text finishes every sequence it starts.
 */
function unfinishedSequenceStart(decoded: string): number | undefined {
  for (let cursor = 0; cursor < decoded.length;) {
    const found = command(decoded, cursor);
    if (found?.kind === 'incomplete' && found.end === decoded.length) {
      return cursor;
    }
    cursor = found?.end ?? cursor + 1;
  }
  return undefined;
}

/**
 * The text without the escape sequence it ends with when the text has not finished it, and without
 * everything after the sequence's start, so the frames open there end with the text, as frames
 * still open at the end of any text do. Part of a sequence written alone is counted as written
 * text, and a terminal reads the text after it as the sequence's own, so that text never shows.
 * The sequence shows once the chunk that finishes it arrives, and at the message's end the message
 * lays out the joined text.
 *
 * The scan reads `laid`, the text the lane view lays out for the text from `from` on, as
 * resolution reads it: decoded from its frames, so frame markup between a sequence's bytes, as two
 * chunks that each wrap part of it in a style call leave it, does not part them. `from` is an
 * offset no sequence runs across, so the scan reads only the text after the last line the message
 * has finished, behind the row that sets up what that line leaves open.
 */
function withoutUnfinishedSequence(text: string, from: number, laid: string): string {
  const trace: Required<WireTrace> = { frames: [], origins: [], whole: [] };
  const decoded = parseText(laid, new Map(), { anyToken: true, mainGlyphs: true, trace }).text;
  const start = unfinishedSequenceStart(decoded);
  const origin = start === undefined ? undefined : trace.origins[start];
  // Where the text from `from` on starts inside `laid`, after the row that sets up the split.
  const offset = laid.length - (text.length - from);
  if (start === undefined || origin === undefined || origin < offset) {
    return text;
  }
  return text.slice(0, from + origin - offset);
}

/**
 * The text so far as the message lays it out before its end: without what its end holds back.
 * `laid` is the text the lane view lays out for the text from `from` on, scanned for an
 * unfinished escape sequence.
 */
function heldBack(text: string, from: number, laid: string): string {
  return withoutTrailingHeld(withoutUnfinishedSequence(text, from, laid));
}

/**
 * The terminal controls resolved text holds after its last line break when no visible text
 * follows them there, which `splitLines` lays out as no row, less the SGR and OSC 8 commands that
 * each row opens and closes for itself, and the line break the method appends after them when it
 * writes the joined text. A line break counts only outside every escape sequence, as `splitLines`
 * counts it, so a title that holds one stays whole. A title or another control there reaches the
 * terminal at the message's end, as it does in the joined text's write.
 */
function controlsAfterLastRow(resolved: string): string {
  const start = lastRowStart(resolved);
  const kept = start === 0 ? undefined : controlsOnly(resolved.slice(start));
  if (kept === undefined || kept === '') {
    return '';
  }
  return endsWithLineBreak(resolved) ? kept : `${kept}\n`;
}

/** The offset after resolved text's last line break outside every escape sequence, or 0 without one. */
function lastRowStart(resolved: string): number {
  let start = 0;
  for (let cursor = 0; cursor < resolved.length;) {
    const found = command(resolved, cursor);
    cursor = found?.end ?? cursor + 1;
    if (found === undefined && resolved[cursor - 1] === '\n') {
      start = cursor;
    }
  }
  return start;
}

/**
 * The controls of resolved text that holds nothing else, less the SGR and OSC 8 commands, or
 * undefined when it holds a character a terminal shows or moves the cursor for.
 */
function controlsOnly(run: string): string | undefined {
  let kept = '';
  for (let cursor = 0; cursor < run.length;) {
    const found = command(run, cursor);
    if (found === undefined) {
      return undefined;
    }
    const own = found.kind === 'sgr' || hyperlinkOpens(found) !== undefined;
    kept += own ? '' : run.slice(cursor, found.end);
    cursor = found.end;
  }
  return kept;
}

/** Every terminal control sequence, captured, so a split keeps each one between the text around it. */
const sequencePieces = new RegExp(`(${controlSequences.source})`, 'u');

/** One run of a resolved row's text, or one control sequence, and the visible offset it ends at. */
interface RowPiece {
  readonly end: number;
  readonly piece: string;
  readonly sequence: boolean;
}

/** A resolved row read as its runs of text and its control sequences, in order. */
function rowPieces(row: string): RowPiece[] {
  let shown = 0;
  // Splitting at a captured control sequence leaves each sequence at an odd index.
  return row.split(sequencePieces).map((piece, index) => {
    const sequence = index % 2 === 1;
    shown += sequence ? 0 : piece.length;
    return { end: shown, piece, sequence };
  });
}

/**
 * The bytes of one resolved row from visible offset `from` on: every character at or after it, and
 * every control sequence after the character before it. With `growing`, the control sequences
 * after the row's last character are left out, because the next chunk's text may come before them,
 * and `shown` is the visible offset the bytes reach.
 */
function visibleFrom(row: string, from: number, growing: boolean): { text: string; shown: number } {
  const pieces = rowPieces(row);
  const last = growing
    ? pieces.reduce(
        (found, { end, piece, sequence }, index) =>
          !sequence && piece !== '' && end > from ? index : found,
        -1,
      )
    : pieces.length;
  const text = pieces
    .slice(0, last + 1)
    .map(({ end, piece, sequence }) => {
      if (sequence) {
        return end >= from ? piece : '';
      }
      return end > from ? piece.slice(Math.max(0, from - (end - piece.length))) : '';
    })
    .join('');
  return { shown: Math.max(pieces.at(-1)?.end ?? 0, from), text };
}

/** An unfinished row as the screen keeps it: rows counted from its visible text alone. */
function frameOf(text: string): Frame | undefined {
  return text === '' ? undefined : { marked: escapeText(visible(text)), text };
}

/** The writes that end a message, and the failure its lane view raised at the final layout, if any. */
interface Closing {
  readonly pieces: Piece[];
  readonly fault?: { readonly cause: unknown } | undefined;
}

/** The value a stopped reading resolves its race with, compared by identity. */
const stopRequested = Symbol('stopRequested');

/** One request of the iterable, or the stop that came first. */
type Pulled = IteratorResult<string> | typeof stopRequested;

/**
 * Tells the iterable that core reads no more, so a generator runs its own cleanup. Its settlement
 * is never awaited, so an iterable suspended at an await never holds the message open.
 */
function endSteps(steps: AsyncIterator<string>): void {
  try {
    const ended: unknown = steps.return?.();
    void handled(Promise.resolve(ended));
  } catch {
    // A cleanup that throws outright is the iterable's business, and it ends here.
  }
}

/** Queues every piece in order and waits for all of them, rejecting with the first failure. */
async function writeAll(sink: MessageSink, pieces: readonly Piece[]): Promise<void> {
  const writes = pieces.map((piece) => sink.write(piece));
  for (const write of writes) {
    void handled(write);
  }
  await Promise.all(writes);
}

/**
 * One streamed message in flight: the text received so far, how much of it has been written, and
 * the reading that ends it. `done` settles as the call does: once the iterable has ended and every
 * write it made has completed, rejecting with what the iterable, the lane view, or a write raised.
 */
class StreamedMessage {
  readonly done: Promise<void>;
  readonly #sink: MessageSink;
  #joined = '';
  /**
   * The lines, or on a terminal the rows, written for good, counted in the text the lane view
   * lays out: from the split on, after the one row that sets up what the lines before it leave open.
   */
  #written = 0;
  /**
   * Where the lines the lane view still lays out begin: the lines before it are finished and
   * written, and never laid out again. It stays at the start for a lane view an author overrode.
   */
  #split = 0;
  /** What the lines before the split leave the lines after it. */
  #carry: Carry = emptyCarry;
  /**
   * Whether the split may move on: the lane view is core's, and no line before it names a token
   * the palette lacks.
   */
  #splits: boolean;
  /** The visible characters of a `print`'s unfinished line already written at the cursor. */
  #head = 0;
  /** What the last layout left unwritten, which a message whose lane view broke ends with. */
  #pending = '';
  #ended = false;
  /** Whether a lane that wraps has stopped drawing an unfinished row, and writes each row once it is finished. */
  #byRow = false;
  /** The writes a stop issued, which the reading awaits before it resolves. */
  #stopping: Promise<unknown> = Promise.resolve();
  #wake: (value: typeof stopRequested) => void = () => undefined;
  readonly #woken: Promise<typeof stopRequested>;

  /** A message `stopped` from the start, as one issued after the run's cancellation, reads no chunk. */
  constructor(source: AsyncIterable<string>, sink: MessageSink, stopped = false) {
    this.#sink = sink;
    this.#splits = sink.partial;
    this.#woken = new Promise((resolve) => {
      this.#wake = resolve;
    });
    if (stopped) {
      this.stop();
    }
    this.done = this.#read(source);
  }

  /**
   * Ends the message now, as the run's cancellation or its action's failure does: the text
   * received so far and its closing line break are queued at once, the iterable is told to stop,
   * and the call resolves once those writes complete.
   */
  stop(): void {
    if (!this.#ended) {
      this.#stopping = writeAll(this.#sink, this.#closing().pieces).catch(() => undefined);
      this.#wake(stopRequested);
    }
  }

  /**
   * The writes that end the message, handed over for the process's end to write at once instead of
   * queued. The reading stops, and the call resolves.
   */
  flush(): Piece[] {
    if (this.#ended) {
      return [];
    }
    const { pieces } = this.#closing();
    this.#wake(stopRequested);
    return pieces;
  }

  /**
   * Reads the iterable to its end, a fault, or a stop, writing as each chunk arrives. A chunk that
   * arrives once a stop has ended the message is discarded.
   */
  async #read(source: AsyncIterable<string>): Promise<void> {
    const steps = await this.#steps(source);
    for (
      let next = await this.#pull(steps);
      next !== stopRequested && !this.#ended;
      next = await this.#pull(steps)
    ) {
      if (next.done === true) {
        return this.#end();
      }
      // A hidden message writes nothing, so it keeps none of the text it drains.
      if (!this.#sink.hidden) {
        this.#joined += next.value;
      }
      await this.#chunk(steps);
    }
    endSteps(steps);
    await this.#stopping;
    return undefined;
  }

  /** The iterable's iterator. A failure to answer one is the iterable's, which ends the message. */
  async #steps(source: AsyncIterable<string>): Promise<AsyncIterator<string>> {
    try {
      return source[Symbol.asyncIterator]();
    } catch (error) {
      return this.#fault(error);
    }
  }

  /** The next chunk, or the stop that came first. A failure the iterable raised ends the message. */
  async #pull(steps: AsyncIterator<string>): Promise<Pulled> {
    if (this.#ended) {
      return stopRequested;
    }
    const pulled = Promise.resolve().then(async () => steps.next());
    void handled(pulled);
    try {
      return await Promise.race([pulled, this.#woken]);
    } catch (error) {
      return this.#fault(error);
    }
  }

  /** The writes one chunk makes, each awaited before the next chunk is read. */
  async #chunk(steps: AsyncIterator<string>): Promise<void> {
    let pieces: Piece[] = [];
    try {
      pieces = this.#advance(false);
    } catch (error) {
      endSteps(steps);
      return this.#fault(error);
    }
    try {
      return await writeAll(this.#sink, pieces);
    } catch (error) {
      this.#ended = true;
      endSteps(steps);
      throw error;
    }
  }

  /** A failure the iterable or the lane view raised: the message ends, and the call rejects with it. */
  async #fault(cause: unknown, pieces?: readonly Piece[]): Promise<never> {
    this.#sink.raise(cause);
    const closing = pieces ?? (this.#ended ? undefined : this.#closing().pieces);
    if (closing !== undefined) {
      await writeAll(this.#sink, closing).catch(() => undefined);
    }
    throw cause;
  }

  /**
   * The iterable's end: the writes that end the message. A lane view that throws at the final
   * layout rejects the call once the message is closed, as one that throws at a chunk does.
   */
  async #end(): Promise<void> {
    const { fault, pieces } = this.#closing();
    return fault === undefined ? writeAll(this.#sink, pieces) : this.#fault(fault.cause, pieces);
  }

  /**
   * The writes that end the message with its joined text and its closing line break, after which
   * it reads and writes nothing more. A lane view that breaks at the end leaves what the last
   * layout had not written, ended with a line break, and its failure.
   */
  #closing(): Closing {
    let closing: Closing = { pieces: [] };
    try {
      closing = { pieces: this.#advance(true) };
    } catch (error) {
      const layout = this.#sink.terminal?.kind;
      const text = `${this.#pending}\n`;
      const piece: Piece =
        layout === 'rows'
          ? { row: dropped, text }
          : { open: layout === 'append' ? false : undefined, text };
      closing = { fault: { cause: error }, pieces: [piece] };
    }
    this.#ended = true;
    return closing;
  }

  /**
   * The writes that take what was written to what the method writes for the text so far, less
   * what its end holds back, or at the end for the joined text and its closing line break.
   * Nothing is laid out before the first chunk that holds text. The lane view lays out the text
   * from the split on, and the split then moves past every line the text has finished.
   */
  #advance(end: boolean): Piece[] {
    const joined = this.#joined;
    const text = end
      ? joined
      : heldBack(joined, this.#split, this.#fromSplit(joined, joined.length));
    if (this.#sink.hidden || (!end && text === '')) {
      return [];
    }
    const pieces = this.#laidOut(this.#sink.render(this.#fromSplit(text, text.length)), end);
    if (!end) {
      this.#moveSplit(text);
    }
    return pieces;
  }

  /** The writes for the lane view's marked text, as the message's destination lays it out. */
  #laidOut(marked: string, end: boolean): Piece[] {
    const layout = this.#sink.terminal;
    if (layout === undefined) {
      return this.#lines(marked, end);
    }
    return layout.kind === 'rows'
      ? this.#rows(marked, end, layout.fits)
      : this.#appended(marked, end, layout.appends);
  }

  /**
   * The text the lane view lays out, through offset `to`: from the start before the split has
   * moved, and after it the row that sets up what the lines before the split leave open, a line
   * break that ends it, and the text from the split on. A lane view core ships lays the lines after that row out as it lays
   * them out in the whole text, so they are the same rows.
   */
  #fromSplit(text: string, to: number): string {
    return this.#split === 0
      ? text.slice(0, to)
      : `${carryText(this.#carry)}\n${text.slice(this.#split, to)}`;
  }

  /**
   * Moves the split past the lines the text so far has finished, which the advance just wrote, so
   * no later chunk lays them out again. The rows they took leave the count of rows written, and the
   * row that sets up what they leave open joins it. A line break inside a frame header or a control
   * string is no place to split, so the split waits for a later one, and a token the palette lacks
   * stops it for the rest of the message.
   */
  #moveSplit(text: string): void {
    const next = text.lastIndexOf('\n') + 1;
    if (!this.#splits || next <= this.#split) {
      return;
    }
    const found = carried(this.#carry, text.slice(this.#split, next), {
      palette: this.#sink.palette(),
      resolve: this.#sink.resolve,
    });
    if (found.kind !== 'carry') {
      this.#splits = found.kind === 'wait';
      return;
    }
    this.#written += 1 - this.#rowsOf(this.#fromSplit(text, next));
    this.#split = next;
    this.#carry = found.carry;
  }

  /** How many rows, or off a terminal lines, the lane view lays a text that ends a line out in. */
  #rowsOf(text: string): number {
    const marked = this.#sink.render(text);
    return this.#sink.terminal === undefined
      ? completeLines(this.#sink.resolve(marked)).lines.length
      : splitLines(marked).length;
  }

  /**
   * Off a terminal: each line completed since the last write, one write a line. At the message's
   * end, the control sequences after the last line break, such as a style's close, join the last
   * line, or follow the lines already written when that line was written before.
   */
  #lines(marked: string, end: boolean): Piece[] {
    const resolved = this.#sink.resolve(marked);
    const whole = end && !endsWithLineBreak(resolved) ? `${resolved}\n` : resolved;
    const { lines, tail } = completeLines(whole);
    const fresh = lines.slice(this.#written);
    this.#written = Math.max(this.#written, lines.length);
    this.#pending = tail;
    if (end && tail !== '') {
      fresh.push(`${fresh.pop() ?? ''}${tail}`);
    }
    return fresh.map((line) => ({ text: line }));
  }

  /**
   * The text's rows, each resolved on its own, whether its last row is finished too, and at the
   * message's end the controls after its last row that no row holds.
   */
  #layout(marked: string, end: boolean): { rows: string[]; closed: boolean; after: string } {
    const rows = splitLines(marked).map((row) => this.#sink.resolve(row));
    const resolved = this.#sink.resolve(marked);
    return {
      after: end ? controlsAfterLastRow(resolved) : '',
      closed: end || endsWithLineBreak(resolved),
      rows,
    };
  }

  /**
   * On a terminal, for a lane that wraps: the rows finished since the last write, written for good,
   * and the unfinished row, which the screen redraws. Once the unfinished row is wider than the
   * screen, as a word longer than the row or a narrowed terminal makes it, no redraw could place
   * it, so the row drawn last leaves the screen and the message writes each later row once it is
   * finished, as off a terminal.
   */
  #rows(marked: string, end: boolean, fits: (frame: Frame) => boolean): Piece[] {
    const { after, closed, rows } = this.#layout(marked, end);
    const finished = this.#finish(closed ? rows : rows.slice(0, -1));
    if (end) {
      this.#pending = '';
      return [{ row: dropped, text: `${finished}${after}` }];
    }
    const rest = closed ? '' : (rows.at(-1) ?? '');
    this.#pending = rest;
    return this.#unfinishedRow(frameOf(rest), finished, fits);
  }

  /**
   * The write that sets the unfinished row while it fits on the screen, or, once it would not, the
   * write that takes the row drawn last off the screen, after which only finished rows are written.
   */
  #unfinishedRow(
    frame: Frame | undefined,
    finished: string,
    fits: (frame: Frame) => boolean,
  ): Piece[] {
    if (!this.#byRow && (frame === undefined || fits(frame))) {
      return [{ row: { frame, kind: 'set' }, text: finished }];
    }
    const row = this.#byRow ? undefined : dropped;
    this.#byRow = true;
    return row === undefined && finished === '' ? [] : [{ row, text: finished }];
  }

  /**
   * On a terminal, for `print`: the rows finished since the last write, less what of the first one
   * was already written at the cursor, and then what the unfinished line adds at the cursor, once
   * that line has started growing there or `appends` lets it start. Nothing written is ever drawn
   * again, so the terminal wraps a long line as it wraps a whole message.
   */
  #appended(marked: string, end: boolean, appends: () => boolean): Piece[] {
    const { after, closed, rows } = this.#layout(marked, end);
    const finished = `${this.#finish(closed ? rows : rows.slice(0, -1))}${after}`;
    const pieces: Piece[] = finished === '' ? [] : [{ open: false, text: finished }];
    const row = closed ? '' : (rows.at(-1) ?? '');
    this.#pending = visibleFrom(row, this.#head, false).text;
    return [...pieces, ...this.#grow(row, appends)];
  }

  /**
   * What the unfinished line adds at the cursor, once it has started growing there or `appends`
   * lets it start, and nothing while it waits for its line break.
   */
  #grow(row: string, appends: () => boolean): Piece[] {
    if (row === '' || (this.#head === 0 && !appends())) {
      return [];
    }
    const { shown, text } = visibleFrom(row, this.#head, true);
    if (text === '') {
      return [];
    }
    this.#head = shown;
    return [{ open: true, text }];
  }

  /**
   * The rows finished since the last write, each ended with a line break, less what of the first
   * one a `print` already wrote at the cursor.
   */
  #finish(finished: readonly string[]): string {
    const fresh = finished
      .slice(this.#written)
      .map((row, index) => `${index === 0 ? visibleFrom(row, this.#head, false).text : row}\n`);
    if (fresh.length > 0) {
      this.#written = finished.length;
      this.#head = 0;
    }
    return fresh.join('');
  }
}

export { StreamedMessage };
export type { MessageSink, Piece, RowChange, TerminalLayout };
