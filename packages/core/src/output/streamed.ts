import { splitLines } from '../style/lines.js';
import { close, escapeText } from '../style/style.js';
import { graphemeWidths } from '../style/width.js';
import { handled } from '../support/thenable.js';
import { controlSequences, endsWithLineBreak, visible } from './region.js';
import type { Frame } from './region.js';

/*
 * One streamed message: a semantic method's text read from an async iterable, laid out through its
 * lane view as each chunk arrives. Off a terminal it is written a completed line at a time; on a
 * terminal that redraws, every row the text finishes is written for good and the last row is the
 * unfinished row, which the screen redraws above the live regions. Once the iterable ends, what was
 * written is what the method writes for the joined text.
 */

/** What one write does to the message's unfinished row: sets it, or takes it off the screen. */
type RowChange =
  | { readonly kind: 'set'; readonly frame: Frame | undefined }
  | { readonly kind: 'drop' };

/** The change that takes a message's unfinished row off the screen, at its end. */
const dropped: RowChange = { kind: 'drop' };

/** One write a streamed message makes: the text written for good, and its unfinished row's change. */
interface Piece {
  readonly text: string;
  /** Absent off a terminal, where a message keeps no unfinished row. */
  readonly row?: RowChange | undefined;
}

/** What one streamed message draws through and writes to, supplied by the output that issued it. */
interface MessageSink {
  /** Whether the run's verbosity hides the message, which is then read to its end and never laid out. */
  hidden: boolean;
  /** The lane view's marked text for the text so far, under one context the message keeps. */
  render: (text: string) => string;
  /** Marked text resolved for the message's destination. */
  resolve: (marked: string) => string;
  /**
   * On a terminal that redraws, the real width of the screen the unfinished row draws on, read at
   * each chunk. Absent elsewhere, where the message writes whole lines.
   */
  rows: { readonly columns: () => number | undefined } | undefined;
  /** Queues one write on the message's destination. */
  write: (piece: Piece) => Promise<void>;
  /** Records a failure the iterable or the lane view raised, which the call rejects with. */
  raise: (cause: unknown) => void;
}

/**
 * A trailing run of spaces, tabs, and carriage returns, with only frame closes after it. The lane
 * views break a row at a space, so a space that ends the text so far can move the word before it
 * to the next row, which the text that follows it may move back; a carriage return waits to learn
 * whether a line feed follows it. Both show once text after them arrives or the message ends.
 */
const trailingBlank = new RegExp(`[ \\t\\r]+(?=${close}*$)`, 'u');

/** The text so far as the message lays it out before its end: without its trailing blank run. */
function heldBack(text: string): string {
  return text.replace(trailingBlank, '');
}

/** Every completed line of resolved text, each with its line break, and the text after the last one. */
function completeLines(text: string): { lines: string[]; tail: string } {
  const lines = text.match(/[^\n]*\n/gu) ?? [];
  return { lines, tail: text.slice(lines.join('').length) };
}

/** The columns between tab stops, as a terminal sets them. */
const tabStop = 8;

/** Where the last screen row starts in visible text written from column 0 on a screen `columns` wide. */
function lastRowStart(text: string, columns: number): number {
  let column = 0;
  let start = 0;
  for (const grapheme of graphemeWidths(text)) {
    const tab = text.slice(grapheme.start, grapheme.end) === '\t';
    const cells = tab
      ? Math.min(tabStop - (column % tabStop), columns - column)
      : Math.min(grapheme.width, columns);
    if (cells > 0 && column + cells > columns) {
      start = grapheme.start;
      column = 0;
    }
    column += cells;
  }
  return start;
}

const hyperlinkClose = '\u001B]8;;\u001B\\';

/** One piece of resolved text: a character or a control sequence, and the visible offset before it. */
interface Token {
  readonly at: number;
  readonly kind: 'text' | 'sgr' | 'link' | 'other';
  readonly piece: string;
}

/** Whether a control sequence sets graphic attributes, opens or closes a hyperlink, or does neither. */
function sequenceKind(sequence: string): Token['kind'] {
  const parameters = sequence.slice(2, -1);
  if (sequence.startsWith('\u001B[') && sequence.endsWith('m') && /^[\d:;]*$/u.test(parameters)) {
    return 'sgr';
  }
  return sequence.startsWith('\u001B]8;') ? 'link' : 'other';
}

/** Every terminal control sequence, captured, so a split keeps each one between the text around it. */
const sequencePieces = new RegExp(`(${controlSequences.source})`, 'u');

/** Resolved text read as its characters and control sequences, each at the visible offset it starts at. */
function tokensOf(text: string): Token[] {
  const tokens: Token[] = [];
  let shown = 0;
  // Splitting at a captured control sequence leaves each sequence at an odd index.
  for (const [index, piece] of text.split(sequencePieces).entries()) {
    if (index % 2 === 1) {
      tokens.push({ at: shown, kind: sequenceKind(piece), piece });
    } else {
      for (const character of piece) {
        tokens.push({ at: shown, kind: 'text', piece: character });
        shown += character.length;
      }
    }
  }
  return tokens;
}

/** The hyperlink the tokens leave open, if any. */
function openLink(tokens: readonly Token[]): string | undefined {
  let open: string | undefined = undefined;
  for (const { kind, piece } of tokens) {
    if (kind === 'link') {
      open = piece === hyperlinkClose ? undefined : piece;
    }
  }
  return open;
}

/**
 * The bytes of one resolved row from visible offset `from` up to `to`. The attributes and the
 * hyperlink set before `from` are set again first, and a slice that ends before the row's end
 * resets them, so the two slices of a row each stand alone.
 */
function sliceVisible(text: string, from: number, to = Number.POSITIVE_INFINITY): string {
  const tokens = tokensOf(text);
  const before = tokens.filter(({ at }) => at < from);
  const replayed = [
    ...before.filter(({ kind }) => kind === 'sgr').map(({ piece }) => piece),
    openLink(before) ?? '',
  ].join('');
  const within = tokens.filter(({ at }) => at >= from && at < to);
  const body = within.map(({ piece }) => piece).join('');
  if (to === Number.POSITIVE_INFINITY) {
    return `${replayed}${body}`;
  }
  const upTo = [...before, ...within];
  const reset = upTo.some(({ kind }) => kind === 'sgr') ? '\u001B[0m' : '';
  return `${replayed}${body}${reset}${openLink(upTo) === undefined ? '' : hyperlinkClose}`;
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
  /** The lines, or on a terminal the rows, written for good. */
  #written = 0;
  /** The visible characters of the unfinished row already written for good, a screen row at a time. */
  #head = 0;
  /** What the last layout left unwritten, which a message whose lane view broke ends with. */
  #pending = '';
  #ended = false;
  /** The writes a stop issued, which the reading awaits before it resolves. */
  #stopping: Promise<unknown> = Promise.resolve();
  #wake: (value: typeof stopRequested) => void = () => undefined;
  readonly #woken: Promise<typeof stopRequested>;

  /** A message `stopped` from the start, as one issued after the run's cancellation, reads no chunk. */
  constructor(source: AsyncIterable<string>, sink: MessageSink, stopped = false) {
    this.#sink = sink;
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
      this.#joined += next.value;
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
      const row = this.#sink.rows === undefined ? undefined : dropped;
      closing = { fault: { cause: error }, pieces: [{ row, text: `${this.#pending}\n` }] };
    }
    this.#ended = true;
    return closing;
  }

  /**
   * The writes that take what was written to what the method writes for the text so far, held
   * back by its trailing blank run, or at the end for the joined text and its closing line break.
   * Nothing is laid out before the first chunk that holds text.
   */
  #advance(end: boolean): Piece[] {
    const text = end ? this.#joined : heldBack(this.#joined);
    if (this.#sink.hidden || (!end && text === '')) {
      return [];
    }
    const marked = this.#sink.render(text);
    return this.#sink.rows === undefined
      ? this.#lines(marked, end)
      : this.#rows(marked, end, this.#sink.rows.columns());
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
   * On a terminal: the rows finished since the last write, written for good, and the unfinished
   * row, of which every screen row but the last is written for good too, so what the screen redraws
   * is never more than one screen row a message.
   */
  #rows(marked: string, end: boolean, columns: number | undefined): Piece[] {
    const rows = splitLines(marked).map((row) => this.#sink.resolve(row));
    const closed = end || endsWithLineBreak(this.#sink.resolve(marked));
    const finished = this.#finish(closed ? rows : rows.slice(0, -1));
    if (end) {
      this.#pending = '';
      return [{ row: dropped, text: finished }];
    }
    const { head, rest } = this.#split(closed ? '' : (rows.at(-1) ?? ''), columns);
    this.#pending = rest;
    return [{ row: { frame: frameOf(rest), kind: 'set' }, text: `${finished}${head}` }];
  }

  /**
   * The rows finished since the last write, each ended with a line break, less the head of the
   * first one when that row was unfinished and its head already written.
   */
  #finish(finished: readonly string[]): string {
    const fresh = finished
      .slice(this.#written)
      .map((row, index) => `${index === 0 ? sliceVisible(row, this.#head) : row}\n`);
    if (fresh.length > 0) {
      this.#written = finished.length;
      this.#head = 0;
    }
    return fresh.join('');
  }

  /**
   * The unfinished row split where its last screen row starts on a screen `columns` wide: the head
   * not yet written, which is written for good, and the rest the screen redraws. A row that holds
   * a carriage return redraws whole, because the return moves its own cursor.
   */
  #split(row: string, columns: number | undefined): { head: string; rest: string } {
    const from = this.#head;
    const shown = visible(row);
    const wraps = columns !== undefined && columns > 0 && !shown.includes('\r');
    const start = wraps ? Math.max(from, lastRowStart(shown, columns)) : from;
    this.#head = start;
    const head = start > from ? sliceVisible(row, from, start) : '';
    return { head, rest: sliceVisible(row, start) };
  }
}

export { StreamedMessage };
export type { MessageSink, Piece, RowChange };
