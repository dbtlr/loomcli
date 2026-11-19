import { Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';

import { FatalError, ResultError } from '../failures/errors.js';
import type { ReportHost } from '../host/host.js';
import { underCI } from '../host/host.js';
import type { ActionChannel } from '../invocation/types.js';
import type { LaneHandlers } from '../signals/signal-lane.js';
import { capabilities, columns, plainPolicy } from '../style/rendering.js';
import type { RenderingPolicy } from '../style/rendering.js';
import { drawnRows, markedWidth, nextColumn, resolveText } from '../style/resolve.js';
import type { Palette } from '../style/state.js';
import { createStyle, tokens } from '../style/style.js';
import { expandTabsMarked, wrapMarked } from '../style/wrap.js';
import { Handed } from '../support/handed.js';
import { handled } from '../support/thenable.js';
import { incompleteResult, lanes } from './lanes.js';
import type { IncompleteResult, Lane } from './lanes.js';
import { LiveRegionSpan } from './live-regions.js';
import type { LiveRegionsHook } from './live-regions.js';
import { logLine, logLineOf } from './log-line.js';
import type { LogLine, LogLineLevel } from './log-line.js';
import type { DestinationFacts, LogEvent } from './log.js';
import { ProgressLedger } from './progress-events.js';
import { endsWithLineBreak, Regions, Screen } from './region.js';
import type { Frame, LiveRegion, Slot } from './region.js';
import { writeSequence } from './sequence.js';
import type { SequenceView } from './sequence.js';
import { StreamedMessage } from './streamed.js';
import type { MessageSink, Piece, TerminalLayout } from './streamed.js';
import type {
  MessageArguments,
  OpenResult,
  Out,
  ProgressEvent,
  RegionCloser,
  ResultBinding,
  ResultTransform,
  ResultView,
  RowView,
  View,
  ViewContext,
} from './types.js';
import { overridden, resolveRowView, resolveView } from './view.js';
import type { ViewRegistry } from './view.js';

export type WriteState = { kind: 'ok' } | { kind: 'failed'; error: unknown };

/**
 * What one destination's writes meet: nothing refused yet, a failed write the run reports as a
 * broken destination, or a reader that closed the run's stdout, which ended the run and whose
 * writes reject with the run signal's reason.
 */
type DestinationState = WriteState | { kind: 'closed'; reason: unknown };

/** What a write a destination refuses rejects with. */
function refusal(state: Exclude<DestinationState, { kind: 'ok' }>): unknown {
  return state.kind === 'closed' ? state.reason : state.error;
}

/**
 * The codes a write reports once the reader of the run's stdout is gone. A pipe reports `EPIPE`
 * under Node and Bun. A socket stdout, which a parent that spawns through libuv hands its child,
 * reports `ENOTCONN` on macOS when Bun writes it with `send()` and the peer is already gone.
 */
const closedReaderCodes: ReadonlySet<unknown> = new Set(['EPIPE', 'ENOTCONN']);

/** Whether one write failed because the reader of the run's stdout closed its end. */
function closedPipe(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    closedReaderCodes.has(error.code)
  );
}

/**
 * How the run's stdout reads a write failure: the run signal's reason once a closed reader ended
 * the run, or nothing for a failure that leaves a broken destination.
 */
type Closing = (error: unknown) => { reason: unknown } | undefined;

/** The semantic calls, which choose a destination. A rendered value has no purpose of its own. */
type Purpose = Lane;

/** The two streams every write site names. */
type Stream = 'stdout' | 'stderr';

/**
 * Where one semantic message goes, and the channel whose failure stops it when it is streamed. The
 * view it draws through comes from the call: the view the call passed, or its lane view.
 */
interface MessageLook {
  readonly destination: Stream;
  readonly live?: LiveSequences | undefined;
}

/** The threshold of a lane that writes at every verbosity. */
const always = Number.NEGATIVE_INFINITY;

/**
 * The lowest verbosity at which each lane writes: `info` and `success` from the default, so one
 * quiet step hides them, and the rest at every verbosity.
 */
const shownFrom: Readonly<Record<Lane, number>> = {
  error: always,
  info: 0,
  print: always,
  success: 0,
  warn: always,
};

/** The lowest verbosity at which a log event shows as a log line: `trace` from `-vv`, the rest from `-v`. */
function logShownFrom(level: LogLineLevel): number {
  return level === 'trace' ? 2 : 1;
}

/** The opener a reservation holds until its own gate publishes the real one. */
const unopened = (): void => undefined;

/**
 * The one callback every write handed to a stream in the call passes, so a long run of them holds
 * no closure per write until the stream calls back. A failure reaches the destination's own error
 * listener instead.
 */
const handedOver = (): void => undefined;

/** The control sequence that shows the terminal's cursor, which a shutdown's end writes. */
const showCursor = '\u001B[?25h';

/**
 * Whether a terminal destination moves its cursor: not with the run's plain switch on, which
 * turns every redraw off, and not under `TERM=dumb`, which cannot.
 */
function movesCursor(env: ReportHost['env'], plain: boolean): boolean {
  return !plain && env.TERM !== 'dumb';
}

/**
 * Whether a terminal destination redraws in place: where it moves its cursor, and not under CI,
 * where the terminal feeds a build log.
 */
function redraws(env: ReportHost['env'], plain: boolean): boolean {
  return movesCursor(env, plain) && !underCI(env);
}

/** One sequence's hold on a destination: the pieces it writes, and the end of its place. */
interface Reservation {
  write: (text: string) => Promise<void>;
  close: () => void;
}

/** A streamed `print`'s hold on the terminal while its line is unfinished: its writes, and its end. */
interface LineHold {
  write: (text: string, between: () => void) => Promise<void>;
  release: () => void;
}

/**
 * One piece of a write as its turn hands it to a stream: the destination it goes to, its bytes, and
 * whether a failure is only recorded, as for the erase and redraw a stdout write sends to stderr.
 */
interface Part {
  readonly destination: Destination;
  readonly text: string;
  readonly quiet: boolean;
}

/**
 * How a destination sends one text write once it reaches the stream, as the parts its turn hands to
 * the streams, produced in the call: a terminal stderr erases the live regions before it and draws
 * them after it, and a terminal stdout does the same while a region is open. `between` changes the
 * screen once the regions are erased and the text is written, before they are drawn again.
 */
type Passage = (text: string, between?: () => void) => Part[];

/**
 * One write queued on a destination and not yet handed to its stream. `order` places it in the
 * run's order: the ticket it was queued at, and a sequence's piece's place among that sequence's
 * pieces. `start` produces its parts as its turn writes them, which an end calls in its place, and
 * once it started, `parts` holds the parts not yet handed to a stream.
 */
interface Queued {
  readonly order: readonly [number, number];
  readonly start: () => Part[];
  /** Whether it is a composition, which a suspend writes at once. */
  readonly composed: boolean;
  /** Whether the live-region span observes its write: a composition's, or one that changes the screen. */
  readonly observed: boolean;
  parts: Part[];
}

/** Whether one queued write comes before another in the run's order, for a sort. */
function byOrder(first: Queued, second: Queued): number {
  return first.order[0] - second.order[0] || first.order[1] - second.order[1];
}

/** A source of increasing numbers, which orders the writes of the destinations that share it. */
function tickets(): () => number {
  let next = 0;
  return () => {
    next += 1;
    return next;
  };
}

/**
 * Hands each part to its stream at once, outside every queue, with adjacent parts for one stream
 * joined into one write.
 */
function writeNow(parts: readonly Part[]): void {
  const writes: { destination: Destination; text: string }[] = [];
  for (const { destination, text } of parts) {
    const last = writes.at(-1);
    if (last?.destination === destination) {
      last.text += text;
    } else {
      writes.push({ destination, text });
    }
  }
  for (const { destination, text } of writes) {
    destination.writeNow(text);
  }
}

/**
 * The turn the destinations on one terminal take to send. One send, with the region erase and
 * redraw around it, reaches the screen before the next one begins. A send waits only for sends
 * that have already begun, never for writes still queued, so a write held behind an open sequence
 * holds no other stream's send.
 */
class Turn {
  #last: Promise<unknown> = Promise.resolve();

  take(send: () => Promise<void>): Promise<void> {
    const pending = this.#last.then(send);
    this.#last = handled(pending);
    return pending;
  }
}

class Destination {
  tail: Promise<void> = Promise.resolve();
  state: DestinationState = { kind: 'ok' };
  passage: Passage | undefined = undefined;
  /**
   * The destination whose order this one's text writes may join, if any, and whether a write issued
   * now joins it.
   */
  order: { shared: Destination; joins: () => boolean } | undefined = undefined;
  /** The turn this destination's sends take with the other destination on the same terminal. */
  turn: Turn | undefined = undefined;
  /**
   * What observes each composition this destination writes, called synchronously right before its
   * bytes reach the stream and right after, which the run's live-region span reads.
   */
  around: { before: () => void; after: () => void } | undefined = undefined;
  /** How many sequences hold a place in this destination's order and have not closed. */
  #sequences = 0;
  /** How many streamed lines hold this destination's order and have not been released. */
  #holds = 0;
  /** The writes queued and not yet begun, in the order they were queued, which an end writes at once. */
  readonly #queued = new Set<Queued>();
  /** The writes whose turn has begun and whose parts have not all reached a stream. */
  readonly #started = new Set<Queued>();

  constructor(
    readonly stream: Writable,
    private readonly closing?: Closing,
    private readonly ticket: () => number = tickets(),
  ) {
    stream.on('error', this.onError);
  }

  readonly onError = (error: unknown): void => {
    if (this.state.kind === 'ok') {
      const closed = this.closing?.(error);
      this.state =
        closed === undefined
          ? { error, kind: 'failed' }
          : { kind: 'closed', reason: closed.reason };
    }
  };

  /** What one failed write rejects with, once the failure is recorded. */
  private refused(error: unknown): unknown {
    this.onError(error);
    return this.state.kind === 'closed' ? this.state.reason : error;
  }

  /**
   * One text queued behind this destination's earlier writes and, when it joins another
   * destination's order, behind that one's too, which then waits for it in turn. `between` is the
   * screen change the write makes at its turn, as a streamed message's unfinished row.
   */
  write(text: string, between?: () => void): Promise<void> {
    const queued = this.queue([this.ticket(), 0], () => this.parts(text, between), {
      composed: false,
      observed: between !== undefined,
    });
    const order = this.joined();
    const previous = order === undefined ? this.tail : Promise.all([this.tail, order.tail]);
    const pending = previous.then(() => this.accept(queued));
    // Keep the returned rejection observable, while accounting for calls without await.
    this.tail = pending.catch(this.onError);
    if (order !== undefined) {
      order.tail = this.tail;
    }
    return pending;
  }

  /**
   * The other destination's order a text write issued now joins, if any. It joins none while a
   * sequence holds a place in this destination's order. A write queued behind that place would
   * otherwise hold the other stream behind the sequence too, and a sequence whose source awaits a
   * write to the other stream would wait on itself.
   */
  private joined(): Destination | undefined {
    const { order } = this;
    if (order === undefined || this.#sequences > 0) {
      return undefined;
    }
    return order.joins() ? order.shared : undefined;
  }

  /** One write held from its call until its turn, or until an end writes it in its place. */
  private queue(
    order: readonly [number, number],
    start: () => Part[],
    kind: Pick<Queued, 'composed' | 'observed'> = { composed: false, observed: false },
  ): Queued {
    const queued: Queued = { ...kind, order, parts: [], start };
    this.#queued.add(queued);
    return queued;
  }

  /** Whether a sequence holds a place in this destination's order. */
  get sequenced(): boolean {
    return this.#sequences > 0;
  }

  /**
   * Whether a write issued now would wait for an earlier one: a write is queued, a write whose turn
   * has begun still has parts to hand to a stream, or a sequence or a streamed line holds the order.
   */
  get waiting(): boolean {
    return (
      this.#queued.size > 0 ||
      this.#sequences > 0 ||
      this.#holds > 0 ||
      [...this.#started].some((started) => started.parts.length > 0)
    );
  }

  /**
   * One text written in the call when nothing waits in this destination's order or in the orders of
   * `alongside`, the destinations on the same screen, and queued as `write` queues it otherwise. A
   * write in the call hands its stream the parts its turn would hand at once, at the place in the
   * order its turn would take, only without waiting a turn of the microtask queue, so the bytes
   * reach the stream before the call returns, as an abort that follows needs. It holds nothing once
   * the call returns: no queued write and no listener, so a loop of such writes grows no memory per
   * write. A stream that fails it records the failure through its error listener, which a later
   * write and the run's settling read, as they read any failed write. It answers the queued write's
   * promise, or nothing for a write already handed to the stream, so it makes no promise either.
   */
  writeFirst(text: string, alongside: readonly Destination[]): Promise<void> | undefined {
    const closed = this.state.kind !== 'ok' || this.stream.destroyed || this.stream.writableEnded;
    if (closed || [this, ...alongside].some(({ waiting }) => waiting)) {
      return this.write(text);
    }
    for (const { destination, text: part } of this.parts(text)) {
      destination.handOver(part);
    }
    return undefined;
  }

  /** Hands text to the stream in the call, recording a failure as the destination's own. */
  private handOver(text: string): void {
    if (text === '' || this.state.kind !== 'ok') {
      return;
    }
    try {
      this.stream.write(text, handedOver);
    } catch (error) {
      this.onError(error);
    }
  }

  /**
   * The parts one text write hands to the streams at its turn, which an end also reads for a
   * streamed message's last write.
   */
  parts(text: string, between?: () => void): Part[] {
    if (this.passage) {
      return this.passage(text, between);
    }
    between?.();
    return [{ destination: this, quiet: false, text }];
  }

  /**
   * One write at its place in the order, on a destination that has not failed. A write an end has
   * already written sends nothing and resolves.
   */
  private accept(queued: Queued): Promise<void> {
    if (!this.#queued.has(queued)) {
      return Promise.resolve();
    }
    if (this.state.kind !== 'ok') {
      this.#queued.delete(queued);
      throw refusal(this.state);
    }
    return this.send(() => this.begin(queued));
  }

  /**
   * Hands one write's parts to their streams at its turn, unless an end wrote it meanwhile. A
   * composition's bytes reach the stream between the span's two observations, in the call.
   */
  private begin(queued: Queued): Promise<void> {
    if (!this.#queued.delete(queued)) {
      return Promise.resolve();
    }
    queued.parts = queued.start();
    if (queued.observed) {
      this.around?.before();
    }
    this.#started.add(queued);
    const sent = this.sendParts(queued).finally(() => {
      this.#started.delete(queued);
    });
    if (queued.observed) {
      this.around?.after();
    }
    return sent;
  }

  /**
   * Hands each part not yet sent to its stream in turn. A quiet part's failure is recorded on its
   * destination, and a failure of the write's own part rejects the write once the quiet parts after
   * it have been sent.
   */
  private async sendParts(queued: Queued): Promise<void> {
    let failure: { error: unknown } | undefined = undefined;
    for (let part = queued.parts.shift(); part !== undefined; part = queued.parts.shift()) {
      if (part.quiet) {
        await part.destination.sendQuietly(part.text);
      } else if (failure === undefined) {
        try {
          await part.destination.writeText(part.text);
        } catch (error) {
          failure = { error };
        }
      }
    }
    if (failure !== undefined) {
      throw failure.error;
    }
  }

  /** Sends now, or once the terminal's turn reaches it when another destination shares the screen. */
  private send(operation: () => Promise<void>): Promise<void> {
    return this.turn === undefined ? operation() : this.turn.take(operation);
  }

  /** One operation queued in this destination's order, which handles its own writes' failures. */
  run(operation: () => Promise<void>): Promise<void> {
    const pending = this.tail.then(operation);
    this.tail = pending.catch(this.onError);
    return pending;
  }

  /**
   * Text composed once it reaches the stream, so it reads the state every earlier write left, and
   * sent as it is, outside the passage. Nothing is sent for the empty string. A composition still
   * queued when `flushComposed` or an end runs is written there instead, and sends nothing when its
   * turn comes.
   */
  compose(produce: () => string): Promise<void> {
    const queued = this.queue(
      [this.ticket(), 0],
      () => {
        const text = produce();
        return text === '' ? [] : [{ destination: this, quiet: false, text }];
      },
      { composed: true, observed: true },
    );
    return this.run(() => this.accept(queued));
  }

  /**
   * Writes every composition still queued straight to the stream, in the order it was queued, and
   * then `after`, synchronously, as a suspend does before the process stops. Every other write
   * keeps its turn, and with `held` every composition keeps its turn too, so a frame held behind a
   * streamed `print`'s unfinished line is not written inside it.
   */
  flushComposed(after: () => string, held = false): void {
    const composed = held ? [] : [...this.#queued].filter((queued) => queued.composed);
    for (const queued of composed) {
      this.#queued.delete(queued);
    }
    const parts = composed.flatMap((queued) => queued.start());
    this.around?.before();
    this.writeNow(parts.map(({ text }) => text).join('') + after());
    this.around?.after();
  }

  /**
   * Takes every write not yet handed to a stream, for an end to write at once in their place: the
   * writes whose turn has begun, whose parts not yet sent the end takes from them, and the writes
   * still queued, which send nothing when their turn comes.
   */
  takeQueued(): { readonly started: readonly Queued[]; readonly queued: readonly Queued[] } {
    const queued = [...this.#queued];
    this.#queued.clear();
    return { queued, started: [...this.#started] };
  }

  /**
   * Hands text to the stream at once, outside the queue. A stream that failed or closed receives
   * nothing, and a write that fails is dropped: this is a best-effort write the process makes on its
   * way out.
   */
  writeNow(text: string): void {
    try {
      if (text !== '' && this.state.kind === 'ok' && !this.stream.destroyed) {
        this.stream.write(text, () => undefined);
      }
    } catch {
      // A terminal that has hung up drops the write.
    }
  }

  /** Sends text now, inside an operation this destination is running, recording any failure. */
  async sendQuietly(text: string): Promise<void> {
    if (text === '' || this.state.kind !== 'ok') {
      return;
    }
    try {
      await this.writeText(text);
    } catch (error) {
      this.onError(error);
    }
  }

  /**
   * One place held in this destination's order from the moment a sequence is issued until it
   * closes. Later calls queue behind the gate, so they write after the sequence's last piece
   * whether or not their caller awaited the sequence, and the gate keeps the destination undrained
   * while the sequence is live, which is what makes a pending sequence open output.
   */
  reserve(): Reservation {
    const previous = this.tail;
    // The pieces take the reservation's place in the run's order, whenever their source yields them.
    const place = this.ticket();
    let pieceCount = 0;
    let open: (pieces: Promise<void>) => void = unopened;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    this.tail = previous.then(() => gate);
    this.#sequences += 1;
    // The sequence's own pieces queue on each other, ahead of the gate that holds its place.
    let pieces = previous;
    return {
      // The sequence closes once, when it ends however it ends.
      close: () => {
        this.#sequences -= 1;
        open(pieces);
      },
      write: (text) => {
        pieceCount += 1;
        const queued = this.queue([place, pieceCount], () => this.parts(text));
        const pending = pieces.then(() => this.accept(queued));
        pieces = pending.catch(this.onError);
        return pending;
      },
    };
  }

  /**
   * A streamed `print`'s unfinished line on a terminal: from now until `release`, every later write
   * to this destination and to `shared`, the other destination on the same terminal, waits, and only
   * the line's own writes reach the stream. They follow every write queued on either before the hold,
   * and the writes held behind it follow the line's last write, so another write lands between two
   * lines and never inside one.
   */
  hold(shared: readonly Destination[]): LineHold {
    const all = [this, ...shared];
    let pieces: Promise<void> = Promise.all(all.map(({ tail }) => tail)).then(() => undefined);
    let open: (pieces: Promise<void>) => void = unopened;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    for (const destination of all) {
      destination.tail = destination.tail.then(() => gate);
      destination.#holds += 1;
    }
    let released = false;
    return {
      release: () => {
        if (!released) {
          released = true;
          for (const destination of all) {
            destination.#holds -= 1;
          }
        }
        open(pieces);
      },
      write: (text, between) => {
        const queued = this.queue([this.ticket(), 0], () => this.parts(text, between), {
          composed: false,
          observed: true,
        });
        const pending = pieces.then(() => this.accept(queued));
        pieces = pending.catch(this.onError);
        return pending;
      },
    };
  }

  private writeText(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stream.destroyed || this.stream.writableEnded) {
        reject(new Error('The output destination is closed.'));
        return;
      }
      const onError = (error: unknown): void => {
        cleanup();
        reject(this.refused(error));
      };
      const onClose = (): void => {
        onError(new Error('The output destination closed before writing completed.'));
      };
      const cleanup = (): void => {
        this.stream.off('error', onError);
        this.stream.off('close', onClose);
      };
      this.stream.on('error', onError);
      this.stream.on('close', onClose);
      try {
        this.stream.write(text, (error) => {
          cleanup();
          if (error) {
            reject(this.refused(error));
          } else {
            resolve();
          }
        });
      } catch (error) {
        onError(error);
      }
    });
  }

  dispose(): void {
    this.stream.off('error', this.onError);
  }
}

/**
 * No contributor at all. A result's selected view is replaced by view name alone, so the
 * Application's override list never reaches a result's views, which carry no identity.
 */
const bare: ViewRegistry = [];

/** The text a view produced, or the value its failure to produce text threw. */
function renderText(produce: () => string): { text: string } | { failed: unknown } {
  try {
    return { text: produce() };
  } catch (error) {
    return { failed: error };
  }
}

/**
 * The call a middleware or a configuration source makes to `out.results`, which the types give no
 * value it accepts, and an action's call on a Command that declares no result. Only the action of a
 * Command that declares a result emits one, so the call throws.
 */
function noResult(): never {
  throw new TypeError('Only the action of a Command that declares a result calls out.results().');
}

/**
 * One output call handed to the code that made it that rejected with a failure core raised in it,
 * and where the call falls in the order the calls were made.
 */
interface RejectedCall {
  readonly call: Handed<unknown>;
  readonly cause: unknown;
  readonly order: number;
}

/**
 * The view a rows result writes through with the run's result transform ahead of it: a row view
 * reads each row through the transform as the row arrives, and a whole view reads the collected rows
 * through it one by one. A throw in the transform is the piece's failure, as a view's throw is, so
 * the rows already written stay.
 */
function transformed(view: SequenceView<never>, transform: ResultTransform): SequenceView<never> {
  if (view.kind === 'whole') {
    const { render } = view;
    return {
      kind: 'whole',
      render: (rows, context) => render(erased(rows.map(transform)), context),
    };
  }
  const { head, row, tail } = view.view;
  return {
    kind: 'rows',
    view: {
      head,
      row: (each, index, context) => row(erased(transform(each)), index, context),
      tail,
    },
  };
}

/**
 * The data one view reads back through the key that resolved it. A result's views are stored with
 * their data type erased, as the view registry erases a declared view's, so the write site hands
 * each function the value its own declaration checked.
 */
function erased(value: unknown): never {
  // Last resort: no typed path exists.
  // A views record holds one entry per view name and carries no type parameter per entry.
  // Every view it stores reads its data as the erased type the registry uses.
  // It holds because the authoring call checked the value against the declaration the record answers.
  // Build proved every entry in that record renders the declared type.
  // A result transform's answer is the claim of the middleware that assigned it, which runs no check.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as never;
}

/**
 * The sequences and the streamed messages one channel has issued. An action that fails while one
 * of them is still pending stays primary, so its sequences are stopped rather than drained. A
 * sequence that finished already answers its own switch with nothing, so it stays, and a streamed
 * message leaves the set at its end, so an ended message and the text it joined are not held.
 */
type LiveSequences = Set<() => void>;

/**
 * What one action's channel has done: the emissions the missing rule reads after the action
 * returned, and the sequences its failure stops.
 */
interface Emission {
  calls: number;
  live: LiveSequences;
  /** The regions the action opened, which close when it returns. */
  regions: Set<LiveRegion>;
}

/** The place in the run's order a streamed message's last write took, which its rest takes at an end. */
interface Place {
  order: readonly [number, number];
}

/**
 * One streamed message still open: where it writes and how, its place, whether it keeps an
 * unfinished row, and the slot that row or its `print` line takes on the screen.
 */
interface OpenStream {
  readonly destination: Destination;
  readonly line: LineWriter;
  readonly message: StreamedMessage;
  readonly place: Place;
  readonly rows: boolean;
  readonly slot: Slot;
}

/** How one streamed message's writes reach its destination, holding the terminal for a `print` line. */
interface LineWriter {
  /** The screen change one of its writes makes, if any. */
  change: (piece: Piece) => (() => void) | undefined;
  /** Whether it holds the terminal while its `print` line is unfinished. */
  readonly holding: boolean;
  /** Queues one write. */
  write: (piece: Piece) => Promise<void>;
  /** Ends the message's hold on the terminal, if it has one. */
  release: () => void;
}

/** Where one write goes, and the channel whose failure stops a sequence written there. */
interface Target {
  destination: Stream;
  live?: LiveSequences | undefined;
}

export class Output {
  private readonly destinations = new Map<Writable, Destination>();
  // Orders the writes of both destinations, so an end writes them in the order they were queued.
  private readonly ticket = tickets();
  // Every failure an output call raised: a view's, a source's that stopped a sequence, and a second result.
  private readonly raised = new Set<unknown>();
  // Every output call that rejected with a failure core raised, which the run reads for one no code observed.
  // A call that settled any other way is not kept, so a long run's writes hold no memory.
  private readonly rejected: RejectedCall[] = [];
  // How many output calls have been handed out, which orders the rejected ones.
  private handedCalls = 0;
  // The path routing walked, which an incomplete sequence names, updated as each name routes.
  private route: readonly string[] = [];
  /**
   * The channel every caller writes through. It is typed with the result left open, because the
   * declaration a call answers to is checked where the action was authored.
   */
  readonly out: Out<OpenResult>;

  private palette: Palette = new Map();
  private policy: RenderingPolicy = {};
  // The incomplete-result lines held until the run settles, which a failure an encoder wrote drops.
  private readonly heldIncomplete: IncompleteResult[] = [];
  // The contributors this invocation resolves a declared view through, published once they build.
  private registry: ViewRegistry = [];
  // The run's verbosity, settled right after graph build, before anything can write a lane.
  private verbosity = 0;
  style = createStyle();
  // Whoever observes the run's progress events; nothing does under run().
  private progressObserver: ((event: ProgressEvent) => void) | undefined = undefined;
  // The stack of open live regions as stderr shows it.
  private readonly screen: Screen;
  // The live regions this run opened.
  private readonly regions: Regions;
  // The span of drawn regions the installed onLiveRegions hooks observe, once the run hands them over.
  private span: LiveRegionSpan | undefined = undefined;
  // The streamed messages still open, which the run waits for and an end writes the rest of.
  private readonly streams = new Set<OpenStream>();
  // Whether an end has written the run's queue, after which a log write goes straight to the stream.
  private ended = false;
  // Ends every open streamed message, then closes every region, at once when the run's signal aborts.
  private readonly onCancel = (): void => {
    for (const open of this.streams) {
      open.message.stop();
    }
    this.regions.closeAll('cancellation');
  };
  // Aborts the run's signal with the closed-pipe reason, once the run has a signal bracket.
  private closePipe: (cause: unknown) => void = () => undefined;
  // Registers the run's suspend and resume handlers, once the run has a place in its lane.
  private suspension: Pick<LaneHandlers, 'onResume' | 'onSuspend'> | undefined = undefined;
  // Whether the reader of stdout closed the pipe, after which no incomplete-result line is written.
  private pipeClosed = false;
  /**
   * The reading of a failed stdout write. A closed reader aborts the run's signal, and every write
   * from then on rejects with its reason, which the run already reports as its end. Any other
   * failure, or one before anything can abort the run, leaves a broken destination.
   */
  private readonly closing: Closing = (error) => {
    if (!closedPipe(error)) {
      return undefined;
    }
    this.closePipe(error);
    if (!this.signal.aborted) {
      return undefined;
    }
    this.pipeClosed = true;
    return { reason: this.signal.reason };
  };

  /**
   * `plain` is the run's plain switch, which core settles right after host capture, so a terminal
   * destination redraws nothing for the whole run when it is on.
   */
  constructor(
    readonly host: ReportHost,
    private readonly signal: AbortSignal,
    private readonly plainSwitch = false,
  ) {
    this.screen = new Screen({
      column: (shown, column) => nextColumn(shown, this.screenColumns(), column),
      rows: (marked) => this.frameRows(marked, undefined, this.screenColumns()),
    });
    this.regions = new Regions(
      {
        cancelled: () => this.signal.aborted,
        // A region's draw hands its rejection to the code that drew, as every output call does.
        frame: (data, view) => {
          const frame = this.frame(data, view, this.host.terminal.stderr.isTTY);
          return 'failed' in frame ? { failed: this.hand(frame.failed) } : frame;
        },
        holdSuspend: () => this.holdSuspend(),
        ledger: new ProgressLedger({
          deliver: (event) => {
            this.progressObserver?.(event);
          },
          plain: (text) => this.context('stderr').plain(text),
        }),
        // An input region draws wherever the terminal moves its cursor, under CI and -q included.
        // Elsewhere a question reads `live` false and asks line by line.
        live: (input) =>
          this.host.terminal.stderr.isTTY &&
          (input
            ? movesCursor(this.host.env, this.plainSwitch)
            : this.verbosity >= 0 && redraws(this.host.env, this.plainSwitch)),
        // A question asks only where stderr is a terminal, so only there do input regions take turns.
        turns: () => this.host.terminal.stderr.isTTY,
        write: (compose) => this.destination(this.host.stderr).compose(compose),
      },
      this.screen,
    );
    this.coordinate();
    signal.addEventListener('abort', this.onCancel, { once: true });
    this.out = {
      ...this.lanes({ destination: 'stdout' }),
      draw: (data: never, value: View<never>) => this.hand(this.draw(data, value)),
      fatal: (message) => {
        throw new FatalError(message);
      },
      lendTerminal: (work) => this.lendTerminal(work),
      // A region a middleware or a source opens closes once the chain has unwound.
      region: (options) => this.regions.open(options),
      // The data type is erased here, as it is in the registry.
      // One call dispatches on the shape of the view it was handed.
      // Every view function reads its data back through its own key.
      render: (data: never, value: View<never> | RowView<never>): Promise<void> =>
        this.hand(this.renderValue(data, value, { destination: 'stdout' })),
      results: noResult,
      text: (data: never, value: View<never>) => this.text(data, value, 'stdout'),
    };
  }

  /**
   * The five semantic methods of one channel: `print` writes to `target.destination` and every
   * other method to stderr, and a streamed message joins `target.live`, whose failure stops it.
   */
  private lanes(target: Target): Pick<Out, Lane> {
    const lane =
      (kind: Lane, destination: Stream) =>
      (...call: MessageArguments): Promise<void> =>
        this.hand(this.emit(kind, call, { destination, live: target.live }));
    return {
      error: lane('error', 'stderr'),
      info: lane('info', 'stderr'),
      print: lane('print', target.destination),
      success: lane('success', 'stderr'),
      warn: lane('warn', 'stderr'),
    };
  }

  private readonly lends = new Set<Promise<void>>();

  /** Waits outside destination queues so work can await ordinary writes. */
  async waitForLends(): Promise<void> {
    while (this.lends.size > 0) {
      await Promise.all(this.lends);
    }
  }

  private async lendTerminal<Value>(work: () => Value | PromiseLike<Value>): Promise<Value> {
    const completion: { resolve?: () => void } = {};
    const settled = new Promise<void>((resolve) => {
      completion.resolve = resolve;
    });
    this.lends.add(settled);
    const screen = this.screenDestination();
    const destination = screen ?? this.destination(this.host.stderr);
    try {
      await destination.compose(() => (screen === undefined ? '' : this.screen.lend()));
      return await work();
    } finally {
      try {
        await destination.compose(() => (screen === undefined ? '' : this.screen.reclaim()));
      } finally {
        this.lends.delete(settled);
        completion.resolve?.();
      }
    }
  }

  /**
   * The channel one action receives. On a Command that declares a result nothing the action writes
   * but the result reaches stdout: `print` and `render` move to stderr, and they move the view
   * context with the destination, so capability detection follows the stream the bytes reach. The
   * destination is decided here, from the declaration, and never from the view a run selected.
   */
  channel(binding: ResultBinding): ActionChannel {
    const destination: Stream = binding.result ? 'stderr' : 'stdout';
    const emission: Emission = { calls: 0, live: new Set(), regions: new Set() };
    const target: Target = { destination, live: emission.live };
    return {
      complete: () => {
        this.regions.closeAll('completion', emission.regions);
      },
      emitted: () => emission.calls > 0,
      fail: () => {
        this.regions.closeAll('failure', emission.regions);
      },
      out: {
        ...this.out,
        ...this.lanes(target),
        region: (options) => this.regions.open(options, emission.regions),
        // The data type is erased here, as it is in the registry.
        // One call dispatches on the shape of the view it was handed.
        // Every view function reads its data back through its own key.
        render: (data: never, value: View<never> | RowView<never>): Promise<void> =>
          this.hand(this.renderValue(data, value, target)),
        results: (value) => this.hand(this.results(binding, emission, value)),
        text: (data: never, value: View<never>) => this.text(data, value, destination),
      },
      stop: () => {
        for (const stop of emission.live) {
          stop();
        }
      },
    };
  }

  /**
   * One `out.results` call on the action's channel. The declaration decides the unit, the selected
   * view decides how it renders, and stdout carries the result under either one. The selected
   * view is the one a middleware named before the action dispatched, or the declaration's default
   * when none did. A second call rejects with a `ResultError` and writes nothing.
   */
  private results(binding: ResultBinding, emission: Emission, value: unknown): Promise<void> {
    const { path, result } = binding;
    if (!result) {
      return noResult();
    }
    if (emission.calls > 0) {
      return this.repeated(path);
    }
    emission.calls += 1;
    const selected = binding.view ?? result.default;
    const view = result.views.get(selected);
    if (!view) {
      // The boundary proved a selected name is a view, but only the types tie the default to one.
      // So an empty views record or a default no view matches fails here, as a broken view does.
      return this.renderFailed(new Error(`The view "${selected}" is not declared.`));
    }
    const { transform } = binding;
    if (result.kind === 'rows') {
      const resolved = this.sequenceView(view, bare);
      return this.sequence(erased(value), transform ? transformed(resolved, transform) : resolved, {
        destination: 'stdout',
        live: emission.live,
      });
    }
    return this.rendered(() => {
      if (typeof view.render !== 'function') {
        throw new TypeError(`The view "${selected}" renders rows, not a value.`);
      }
      const data = transform ? transform(value) : value;
      return resolveView(bare, view)(erased(data), this.context('stdout'));
    });
  }

  /** A second `out.results` call, which rejects and writes nothing, like any failed output call. */
  private repeated(path: readonly string[]): Promise<void> {
    const fault = new ResultError('repeated', path);
    this.raised.add(fault);
    const rejected = Promise.reject(fault);
    void handled(rejected);
    return rejected;
  }

  /**
   * A call core rejects with a failure it raised outside output, such as a `next()` misuse, handed
   * to the code that made it as an output call is. Once that code observed it, the failure is its
   * own to handle, and when no code did, the run reports it after the chain settles.
   */
  handFailure(fault: unknown): Promise<never> {
    this.raised.add(fault);
    return this.hand(Promise.reject(fault));
  }

  /**
   * One output call handed to the code that made it. A failure core raised in it, which the call
   * rejects with, is that code's to handle once it observed the call, and has no catcher otherwise.
   */
  private hand<Value>(pending: Promise<Value>): Promise<Value> {
    const call = Handed.of(pending);
    const order = this.handedCalls++;
    void pending.catch((error: unknown) => {
      if (this.raised.has(error)) {
        this.rejected.push({ call, cause: error, order });
      }
    });
    return call;
  }

  /**
   * Every failure a handed call raised that no code observed, such as a render whose view threw
   * in a call the action never awaited, or a `next()` misuse, in the order the calls were made. A failure that code
   * observed through one call is that code's, whichever other call carried it.
   */
  uncaught(): readonly unknown[] {
    const rejected = [...this.rejected];
    // A call made earlier can reject later, behind writes queued on its destination.
    rejected.sort((first, second) => first.order - second.order);
    const observed = new Set<unknown>();
    for (const { call, cause } of rejected) {
      if (call.observed) {
        observed.add(cause);
      }
    }
    const causes = new Set<unknown>();
    for (const { cause } of rejected) {
      if (!observed.has(cause)) {
        causes.add(cause);
      }
    }
    return [...causes];
  }

  /** What ends the run when the reader of its stdout closes the pipe. */
  useClosedPipe(close: (cause: unknown) => void): void {
    this.closePipe = close;
  }

  /** The run's own suspend and resume registration, which its live regions hold while open. */
  useSuspension(handlers: Pick<LaneHandlers, 'onResume' | 'onSuspend'>): void {
    this.suspension = handlers;
  }

  /**
   * Erases the live regions on a suspend and redraws them on the resume until the call it answers.
   * The erase is written straight to the terminal, after every region frame still queued, with the
   * cursor shown, because the process stops as the suspend handlers return. While a streamed
   * `print` line holds the terminal, the frames queued keep their turn behind it. The redraw is
   * queued, so a write queued before the suspend reaches the screen first.
   */
  private holdSuspend(): () => void {
    const { suspension } = this;
    const destination = this.screenDestination();
    if (suspension === undefined || destination === undefined) {
      return () => undefined;
    }
    const removers = [
      suspension.onSuspend(() => {
        destination.flushComposed(
          () => (this.screen.lending > 0 ? '' : this.screen.suspend() + this.cursorShown()),
          this.lineHeld(),
        );
      }),
      suspension.onResume(() => {
        void handled(destination.compose(() => this.screen.resume()));
      }),
    ];
    return () => {
      for (const remove of removers) {
        remove();
      }
    };
  }

  /**
   * The installed `onLiveRegions` hooks, in installation order, which this run calls at the first
   * frame its regions hold and at the write after which none holds one.
   */
  useLiveRegionsHooks(hooks: readonly LiveRegionsHook[]): void {
    this.span = hooks.length === 0 ? undefined : new LiveRegionSpan(hooks, this.out);
  }

  /** The first value an `onLiveRegions` hook threw in this run, which the run reports once. */
  get liveRegionsThrow(): { readonly value: unknown } | undefined {
    return this.span?.thrown;
  }

  /** The registry one invocation resolves through, republished as each contributor is read. */
  useViews(registry: ViewRegistry): void {
    this.registry = registry;
  }

  /** The run's verbosity, which decides which lanes write from here on. */
  useVerbosity(verbosity: number): void {
    this.verbosity = verbosity;
  }

  /** The path routing walked, updated as each name routes, which an incomplete sequence names. */
  useRoute(path: readonly string[]): void {
    this.route = path;
  }

  /** Whoever observes this run's progress events, each delivered inside the call that built it. */
  observeProgress(observer: (event: ProgressEvent) => void): void {
    this.progressObserver = observer;
  }

  /**
   * Writes every write still queued on the run's stdout and stderr straight to its stream, in the
   * order the writes were queued and each as its turn would have written it, then, on a terminal
   * stderr, ends every lend and shows the cursor, synchronously, which the process's end does. A
   * write whose turn has begun goes first, with only the parts it has not yet sent. No hook is
   * called while it writes, so a first frame among the writes opens no span. From then on the run
   * has ended, and a log write goes straight to the stream.
   */
  flushQueue(): void {
    const parts = this.queuedParts();
    const screen = this.screenDestination();
    if (screen !== undefined) {
      // A screen on stdout alone shows the cursor nowhere, because only stderr's draws can hide it.
      const shown = screen === this.destination(this.host.stderr) ? this.cursorShown() : '';
      parts.push({ destination: screen, quiet: true, text: this.screen.finishLends() + shown });
    }
    writeNow(parts);
    this.ended = true;
    // The process is ending, so a span still open closes after those bytes.
    this.span?.finish();
  }

  /**
   * Takes every write not yet handed to a stream, the rest of each open streamed message included,
   * and answers their parts in the run's order, each as its turn would have written it. A write
   * whose turn has begun comes first, with only the parts it has not yet sent.
   */
  private queuedParts(): Part[] {
    const taken = [...this.destinations.values()].map((destination) => destination.takeQueued());
    const started = taken.flatMap((writes) => writes.started);
    started.sort(byOrder);
    const queued = [...taken.flatMap((writes) => writes.queued), ...this.streamEnds()];
    queued.sort(byOrder);
    return [
      ...started.flatMap((write) => write.parts.splice(0)),
      ...queued.flatMap((write) => write.start()),
    ];
  }

  /**
   * Writes one text a log event makes on the run's stderr: its log line, or what an `onLog` hook
   * writes there. It is written in the call when nothing waits ahead of it on stderr, or on stdout
   * when both share a terminal, and queued behind what waits otherwise, so it keeps call order
   * either way. Once an end has written the run's queue, nothing written later is waited for, so it
   * writes whatever was queued since, then itself, straight to the stream, as a shutdown handler's
   * log call at the process's exit needs. It answers the promise of a write it queued, and nothing
   * for one it handed to the stream.
   */
  private writeLog(text: string): Promise<void> | undefined {
    const errors = this.destination(this.host.stderr);
    if (this.ended) {
      writeNow([...this.queuedParts(), { destination: errors, quiet: false, text }]);
      return undefined;
    }
    return errors.writeFirst(text, this.sharing(errors));
  }

  /**
   * The control sequence that shows the cursor again, on a terminal that redraws in place or when
   * the Application preserves terminal controls. Otherwise every `out.draw` that could hide the
   * cursor dropped its control sequences, so nothing hid it.
   */
  private cursorShown(): string {
    return redraws(this.host.env, this.plainSwitch) || this.policy.terminalControls === 'preserve'
      ? showCursor
      : '';
  }

  /**
   * Closes every live region still open, or waiting to open: with `'completion'` once the
   * middleware chain has unwound, and with `'failure'` before any failure report renders, so each
   * region's last frame is written above it.
   */
  closeRegions(closer: RegionCloser): void {
    this.regions.closeAll(closer);
  }

  /**
   * The destination an `onLog` hook writes to, with its stderr carried through this run's stderr
   * order whenever it is the run's stderr, a terminal or not, so a hook's record keeps call order
   * with the run's log lines, warnings, and progress lines, and on a terminal lands above the open
   * regions. Each chunk is written as `writeLog` writes it when the hook writes it, and is
   * acknowledged at once, so records a hook writes together stay together, ahead of any write core
   * queues after them. A chunk with nothing waiting ahead of it reaches the stream in the call, and
   * one written after an end goes straight to the stream.
   */
  logDestination(destination: DestinationFacts): DestinationFacts {
    const { stderr } = destination;
    if (stderr !== this.host.stderr) {
      return destination;
    }
    const carried = new Writable({
      write: (chunk: unknown, _encoding, done) => {
        // The stream's own failure is the run's, recorded where the write was made.
        const queued = this.writeLog(String(chunk));
        if (queued !== undefined) {
          void handled(queued);
        }
        done();
      },
    });
    return Object.freeze({ ...destination, stderr: carried });
  }
  /** Whether the run's verbosity shows a log event at `level` as a log line. */
  showsLog(level: LogLineLevel): boolean {
    return this.verbosity >= logShownFrom(level);
  }

  /**
   * Shows one log event as a log line on stderr, through the log-line view, when the run's
   * verbosity shows its level, written as `writeLog` writes it. A failure event never shows,
   * because the run reports the failure itself. The write is an output call no code observes, so a
   * log-line view that throws is reported once the chain settles, and a stream that refuses the
   * write is a broken destination. A view that returns the empty string writes nothing.
   */
  showLog(event: LogEvent): void {
    const line = logLineOf(event);
    if (line === undefined || !this.showsLog(line.level)) {
      return;
    }
    void this.hand(
      this.rendered(
        () => resolveView<LogLine>(this.registry, logLine)(line, this.context('stderr')),
        'stderr',
        async (text) => {
          if (text !== '') {
            await this.writeLog(endsWithLineBreak(text) ? text : `${text}\n`);
          }
        },
      ),
    );
  }

  /**
   * At a terminal stderr, every text write erases the live regions before it and draws them after
   * it. When stdout is a terminal too, a stdout write issued while a region is open joins stderr's
   * order, so the two streams keep one call order, and it erases and redraws the regions as a stderr
   * write does. A stdout write issued while a sequence holds a place in stdout's order keeps
   * stdout's order alone, so a stderr write, one the sequence's source makes included, never waits
   * behind the sequence.
   * The two streams take turns to send, so a row a sequence writes to stdout reaches the screen whole
   * between stderr's writes. With no region open, a stdout write keeps its own order and still moves
   * the row the next stack starts on, because both streams show on one screen.
   */
  private coordinate(): void {
    const { stderr, stdout, terminal } = this.host;
    if (!terminal.stderr.isTTY) {
      this.coordinateStdout();
      return;
    }
    const errors = this.destination(stderr);
    errors.around = this.observer;
    errors.passage = (text, between) => {
      const { after, before } = this.screen.around(text, between);
      return [{ destination: errors, quiet: false, text: before + text + after }];
    };
    if (!terminal.stdout.isTTY || stdout === stderr) {
      return;
    }
    const output = this.destination(stdout);
    output.around = this.observer;
    const turn = new Turn();
    errors.turn = turn;
    output.turn = turn;
    output.order = { joins: () => this.screen.holding || this.lineHeld(), shared: errors };
    output.passage = (text, between) => {
      if (!this.screen.holding) {
        this.screen.note(text);
        between?.();
        return [{ destination: output, quiet: false, text }];
      }
      const { after, before } = this.screen.around(text, between);
      return [
        { destination: errors, quiet: true, text: before },
        { destination: output, quiet: false, text },
        { destination: errors, quiet: true, text: after },
      ];
    };
  }

  /**
   * A terminal stdout beside a stderr that is not one, as under `cli 2>log`, is the screen alone:
   * no region draws there and nothing is redrawn, and a streamed `print` grows its line there at
   * the cursor, which the run's live-region span observes.
   */
  private coordinateStdout(): void {
    const { stderr, stdout, terminal } = this.host;
    if (!terminal.stdout.isTTY || stdout === stderr) {
      return;
    }
    const output = this.destination(stdout);
    output.around = this.observer;
    output.passage = (text, between) => {
      this.screen.note(text);
      between?.();
      return [{ destination: output, quiet: false, text }];
    };
  }

  /**
   * What observes each write that can change what the screen holds, right before its bytes reach
   * the stream and right after: a region's frame, a streamed message's unfinished row, and a
   * streamed `print`'s unfinished line each hold it, and the run's live-region span reads that.
   */
  private readonly observer = {
    after: (): void => {
      this.span?.after(this.screen.holdsFrame);
    },
    before: (): void => {
      this.span?.before(this.screen.holdsFrame);
    },
  };

  /**
   * The destination the screen draws through: stderr when it is a terminal, or else stdout when
   * that is, and none when neither is.
   */
  private screenDestination(): Destination | undefined {
    const { stderr, stdout, terminal } = this.host;
    if (terminal.stderr.isTTY) {
      return this.destination(stderr);
    }
    return terminal.stdout.isTTY ? this.destination(stdout) : undefined;
  }

  /** The real width of the terminal the screen draws on, never narrowed by `COLUMNS`. */
  private screenColumns(): number | undefined {
    const { terminal } = this.host;
    return terminal.stderr.isTTY ? terminal.stderr.columns : terminal.stdout.columns;
  }

  /**
   * The rows a frame's marked text takes at stderr's current width, or at `width`, counted as it
   * resolves, with its control sequences kept when `controls` is true.
   */
  private frameRows(
    marked: string,
    controls = this.host.terminal.stderr.isTTY,
    width = this.host.terminal.stderr.columns,
  ): number {
    return drawnRows(marked, {
      caps: this.drawCaps(controls),
      columns: width,
      palette: this.palette,
    });
  }

  /** The capabilities a drawn frame resolves under: stderr's, with its controls kept when asked. */
  private drawCaps(controls: boolean) {
    const caps = capabilities(this.host, 'stderr', this.policy);
    caps.terminalControls ||= controls;
    return caps;
  }

  /**
   * One frame of a region or of `out.draw`: the view runs inside the call with stderr's context,
   * its marked text is kept so the frame's rows can be counted now and recounted at a later width,
   * and a view that throws fails this call.
   */
  private frame(
    data: unknown,
    value: View<never>,
    controls: boolean,
  ): Frame | { failed: Promise<void> } {
    try {
      const marked = String(
        resolveView(this.registry, value)(erased(data), this.context('stderr')),
      );
      return { marked, text: resolveText(marked, this.palette, this.drawCaps(controls)) };
    } catch (error) {
      return { failed: this.renderFailed(error) };
    }
  }

  configure(policy: RenderingPolicy, palette: Palette): void {
    this.policy = policy;
    this.palette = palette;
    this.style = createStyle(new Set([...tokens, ...palette.keys()]));
  }

  /**
   * Marked text resolved as plain text for stderr, as an invocation by name resolves its captured
   * text: no color, modifier, or hyperlink, whatever the policy or `FORCE_COLOR` says, and the
   * policy's own terminal controls. A failure form reads its message and hints through it.
   */
  plain(text: string): string {
    const policy = plainPolicy(this.policy);
    return resolveText(text, this.palette, capabilities(this.host, 'stderr', policy));
  }

  /** A fresh context for one render call, holding the destination's width read now. */
  context(destination: Stream): ViewContext {
    const caps = capabilities(this.host, destination, this.policy);
    const { palette } = this;
    return Object.freeze({
      background: this.host.terminal.background,
      columns: columns(this.host, destination),
      expandTabs: (text: string) => expandTabsMarked(text, { caps, palette }),
      plain: (text: string) =>
        resolveText(text, this.palette, {
          ...caps,
          color: false,
          hyperlinks: false,
          modifiers: false,
          terminalControls: false,
        }),
      style: this.style,
      width: (text: string) => markedWidth(text, this.palette, caps),
      wrap: (text: string, limit: number | undefined) => wrapMarked(text, limit, { caps, palette }),
    });
  }

  /**
   * A semantic message on its destination; only `print` writes to stdout. The message draws
   * through the call's own view when it passed one, and through its lane view otherwise. Either
   * way it ends with exactly one line break: this call appends one after the resolved text unless
   * that text already ends with one, so a lane view returns none, a pack view that ends its own
   * lines gains none, and a view that returns the empty string still writes one. A call the run's
   * verbosity hides calls no view and writes nothing. A message that is an async iterable of its
   * text is a streamed message, which takes no view.
   */
  emit(kind: Purpose, call: MessageArguments, look: MessageLook): Promise<void> {
    const [message, view = lanes[kind]] = call;
    if (typeof message !== 'string') {
      return this.streamed(kind, message, look);
    }
    const { destination } = look;
    if (this.verbosity < shownFrom[kind]) {
      return Promise.resolve();
    }
    return this.rendered(
      () => resolveView<string>(this.registry, view)(message, this.context(destination)),
      destination,
      (text) => this.write(this.host[destination], endsWithLineBreak(text) ? text : `${text}\n`),
    );
  }

  /**
   * One streamed message on its method's destination, read from here until its iterable ends. A
   * message the run's verbosity hides is read to its end and laid out never. On a terminal that
   * redraws, a lane that wraps keeps its unfinished row above the live regions and the screen holds
   * a suspend while it is open, and `print` grows its line at the cursor, holding every other write
   * to the terminal until the line ends; elsewhere it writes each line once it completes. The view
   * context is read once, at its first layout, so the whole message lays out at one width. A
   * message an action issued joins its channel's live set, so the action's failure stops it, and
   * leaves it at its end.
   */
  private streamed(kind: Purpose, source: AsyncIterable<string>, look: MessageLook): Promise<void> {
    const { destination } = look;
    const hidden = this.verbosity < shownFrom[kind];
    const target = this.destination(this.host[destination]);
    const redrawn =
      !hidden && this.host.terminal[destination].isTTY && redraws(this.host.env, this.plainSwitch);
    const rows = redrawn && kind !== 'print';
    const slot: Slot = { closed: false, input: false, latest: undefined, shown: undefined };
    let context: ViewContext | undefined = undefined;
    const place: Place = { order: [this.ticket(), 0] };
    const line = this.lineWriter(target, slot);
    const sink: MessageSink = {
      hidden,
      partial: !overridden<string>(this.registry, lanes[kind]),
      raise: (cause) => {
        this.raised.add(cause);
      },
      render: (text) => {
        context ??= this.context(destination);
        return String(resolveView<string>(this.registry, lanes[kind])(text, context));
      },
      resolve: (marked) =>
        resolveText(marked, this.palette, capabilities(this.host, destination, this.policy)),
      terminal: this.terminalLayout(redrawn, rows, target),
      write: (piece) => {
        const written = line.write(piece);
        place.order = [this.ticket(), 0];
        return written;
      },
    };
    const release = rows ? this.holdSuspend() : undefined;
    const message = new StreamedMessage(source, sink, this.signal.aborted);
    const open: OpenStream = { destination: target, line, message, place, rows, slot };
    this.streams.add(open);
    const stop = (): void => {
      message.stop();
    };
    look.live?.add(stop);
    const done = message.done.finally(() => {
      this.streams.delete(open);
      look.live?.delete(stop);
      line.release();
      release?.();
    });
    void handled(done);
    return done;
  }

  /**
   * How a streamed message lays out on a terminal that redraws, if it is on one: a lane that wraps
   * keeps an unfinished row, and `print` grows its line at the cursor while no live region is
   * open, no other streamed message keeps an unfinished row, and no row sequence holds the order of
   * either stream on its terminal, and writes a whole line at a time otherwise. A line held while a
   * sequence is open would start behind the sequence and hold every write to the terminal behind it,
   * a stderr write the sequence's source awaits included.
   */
  private terminalLayout(
    redrawn: boolean,
    rows: boolean,
    target: Destination,
  ): TerminalLayout | undefined {
    if (!redrawn) {
      return undefined;
    }
    if (rows) {
      return { fits: (frame) => this.screen.fits(frame), kind: 'rows' };
    }
    return {
      appends: () =>
        !this.regions.drawing &&
        ![target, ...this.sharing(target)].some(({ sequenced }) => sequenced) &&
        ![...this.streams].some((open) => open.rows),
      kind: 'append',
    };
  }

  /**
   * How one streamed message's writes reach its destination. A `print` write that leaves its line
   * unfinished on a terminal starts a hold on the terminal, or writes through the one it holds, and
   * the write that ends the line ends the hold, so every other write lands after the line.
   */
  private lineWriter(target: Destination, slot: Slot): LineWriter {
    let hold: LineHold | undefined = undefined;
    const release = (): void => {
      hold?.release();
      hold = undefined;
    };
    return {
      change: (piece) => this.pieceChange(slot, piece),
      get holding() {
        return hold !== undefined;
      },
      release,
      write: (piece) => {
        const between = this.pieceChange(slot, piece);
        if (piece.open === true) {
          hold ??= target.hold(this.sharing(target));
        }
        if (hold === undefined || between === undefined) {
          return target.write(piece.text, between);
        }
        const written = hold.write(piece.text, between);
        if (piece.open !== true) {
          release();
        }
        return written;
      },
    };
  }

  /** Whether a streamed `print` holds the terminal while its line is unfinished. */
  private lineHeld(): boolean {
    return [...this.streams].some(({ line }) => line.holding);
  }

  /** The other destination on the terminal `target` writes to, when both streams are on it. */
  private sharing(target: Destination): Destination[] {
    const { stderr, stdout, terminal } = this.host;
    if (!terminal.stderr.isTTY || !terminal.stdout.isTTY || stdout === stderr) {
      return [];
    }
    const other = target === this.destination(stdout) ? stderr : stdout;
    return [this.destination(other)];
  }

  /**
   * The screen change one write of a streamed message makes, if any: to its unfinished row, or to
   * whether its `print` line is unfinished.
   */
  private pieceChange(slot: Slot, piece: Piece): (() => void) | undefined {
    const { open, row } = piece;
    if (open !== undefined) {
      return () => {
        this.screen.line(slot, open);
      };
    }
    if (row === undefined) {
      return undefined;
    }
    return row.kind === 'drop'
      ? () => {
          this.screen.dropRow(slot);
        }
      : () => {
          this.screen.row(slot, row.frame);
        };
  }

  /**
   * The rest of each open streamed message, for the process's end to write in its place: after its
   * last write, as its end would write it, its unfinished row or last line and its one closing line
   * break. Each message reads no further chunk, and a `print` gives up its hold on the terminal.
   */
  private streamEnds(): Queued[] {
    return [...this.streams].map((open) => ({
      composed: false,
      observed: false,
      order: open.place.order,
      parts: [],
      start: () => {
        const parts = open.message
          .flush()
          .flatMap((piece) => open.destination.parts(piece.text, open.line.change(piece)));
        open.line.release();
        return parts;
      },
    }));
  }

  /**
   * The failure report of one invocation. Like `render`, the text is queued on its destination
   * after style resolution: the caller already carries its own trailing newline, whether that text
   * came from a resolved view or from core's own default text.
   */
  report(text: string): Promise<void> {
    return this.rendered(() => text, 'stderr');
  }

  /**
   * A failure encoder's text, queued on stderr as it is: no markup resolves and nothing is escaped,
   * because the encoder owns its bytes, its trailing newline included.
   */
  encoded(text: string): Promise<void> {
    return this.write(this.host.stderr, text);
  }

  /**
   * Writes each incomplete-result line this run holds, in the order its sequences stopped, ahead of
   * whatever the run reports next. Each resolves through the registry like any other rendered
   * output, so an override that returns the empty string silences it and one that throws fails
   * the line. A stderr that has failed already takes the plain fallback path and no further. It
   * answers what the first line whose view threw raised, which no code can catch.
   */
  async writeIncomplete(): Promise<{ cause: unknown } | undefined> {
    await this.waitForLends();
    // A reader that closed stdout stopped reading on purpose, so no line reports the truncation.
    if (this.pipeClosed) {
      this.dropIncomplete();
      return undefined;
    }
    let fault: { cause: unknown } | undefined = undefined;
    for (const facts of this.heldIncomplete.splice(0)) {
      const context = this.context('stderr');
      const failed = this.destinations.get(this.host.stderr)?.state.kind === 'failed';
      await (failed
        ? reportPlainly(this.host.stderr, incompleteResult.render(facts, context))
        : this.rendered(
            () => resolveView(this.registry, incompleteResult)(facts, context),
            'stderr',
          ).catch((error: unknown) => {
            if (this.raised.has(error)) {
              fault ??= { cause: error };
            }
          }));
    }
    return fault;
  }

  /**
   * Drops each incomplete-result line this run holds, because a failure encoder wrote the run's
   * failure: the encoded line is the only failure text on stderr, and it tells a reader the result
   * is incomplete.
   */
  dropIncomplete(): void {
    this.heldIncomplete.length = 0;
  }

  /**
   * One `out.draw` call: a region of one frame, rendered as a region's frame is, written in
   * stderr's order, and resolving the rows it took at stderr's width when it rendered.
   */
  private async draw(data: unknown, value: View<never>): Promise<number> {
    // A terminal that does not redraw keeps the Application's setting, as a redirected stderr does.
    const controls = this.host.terminal.stderr.isTTY && redraws(this.host.env, this.plainSwitch);
    const frame = this.frame(data, value, controls);
    if ('failed' in frame) {
      await frame.failed;
      return 0;
    }
    const rows = this.frameRows(frame.marked, controls);
    await this.write(this.host.stderr, frame.text);
    return rows;
  }

  /**
   * One `out.text` call: the text `out.render` would queue on the destination, resolved the same
   * way and queued nowhere. A view that throws throws to the caller.
   */
  private text(data: never, value: View<never>, destination: Stream): string {
    const render = resolveView(this.registry, value);
    const marked = String(render(data, this.context(destination)));
    return resolveText(marked, this.palette, capabilities(this.host, destination, this.policy));
  }

  /** One `out.render` call, dispatched on the shape of the view it was handed. */
  private renderValue(
    data: never,
    value: View<never> | RowView<never>,
    target: Target,
  ): Promise<void> {
    if (typeof value.render === 'function') {
      return this.rendered(
        () => resolveView(this.registry, value)(data, this.context(target.destination)),
        target.destination,
      );
    }
    return this.sequence(data, this.sequenceView(value, this.registry), target);
  }

  /**
   * The view one sequence writes through, in the shape its own view carries. The caller supplies
   * the contributors the view resolves through: `out.render`'s call-site view resolves through
   * this invocation's registry, as ADR-0021 requires, and a result's view resolves through none,
   * because a result's selected view is replaced by view name alone.
   */
  private sequenceView(value: ResultView, registry: ViewRegistry): SequenceView<never> {
    if (typeof value.row === 'function') {
      return { kind: 'rows', view: resolveRowView(registry, value) };
    }
    const render = resolveView(registry, value);
    return { kind: 'whole', render: (rows, context) => render(erased(rows), context) };
  }

  /**
   * One sequence, which holds its place on the destination from here until its last piece is
   * written. The returned rejection is observed here as well, because an action that never awaits
   * the call must not end the process with an unhandled rejection.
   */
  private sequence(source: never, view: SequenceView<never>, target: Target): Promise<void> {
    const { destination } = target;
    const place = this.destination(this.host[destination]).reserve();
    const sequence = writeSequence({
      close: place.close,
      context: () => this.context(destination),
      incomplete: (facts) => {
        this.incomplete(facts);
      },
      path: this.route,
      piece: (produce) => this.rendered(produce, destination, place.write),
      signal: this.signal,
      source,
      stopped: (cause) => {
        this.raised.add(cause);
      },
      view,
    });
    // A sequence its own channel can stop, so an action's failure ends it rather than draining it.
    target.live?.add(sequence.stop);
    void handled(sequence.pending);
    return sequence.pending;
  }

  /**
   * Holds the line one incomplete sequence owes until the run settles. The run writes it ahead of
   * the fault's own report, or at its end when it reports none, unless a failure encoder writes the
   * run's failure.
   */
  private incomplete(facts: IncompleteResult): void {
    this.heldIncomplete.push(facts);
  }

  /**
   * The write site owns its newline; core resolves the view's marked text before queuing it. A
   * throw rejects this call alone: nothing is written for it, and later output still writes.
   */
  private rendered(
    produce: () => unknown,
    destination: Stream = 'stdout',
    write?: (text: string) => Promise<void>,
  ): Promise<void> {
    const rendered = renderText(() =>
      resolveText(
        String(produce()),
        this.palette,
        capabilities(this.host, destination, this.policy),
      ),
    );
    if (!('text' in rendered)) {
      return this.renderFailed(rendered.failed);
    }
    return write ? write(rendered.text) : this.write(this.host[destination], rendered.text);
  }

  /**
   * The rejected call. The rejection is observed here as well, because an action that never awaits
   * the call must not end the process with an unhandled rejection.
   */
  private renderFailed(cause: unknown): Promise<void> {
    this.raised.add(cause);
    const rejection = Promise.reject(cause);
    void handled(rejection);
    return rejection;
  }

  /**
   * The queue one stream writes through, opened the first time this invocation reaches it. Only
   * the run's own stdout reads a closed reader as the end of the run.
   */
  private destination(stream: Writable): Destination {
    let destination = this.destinations.get(stream);
    if (!destination) {
      const { stderr, stdout } = this.host;
      const ends = stream === stdout && stream !== stderr;
      destination = new Destination(stream, ends ? this.closing : undefined, this.ticket);
      this.destinations.set(stream, destination);
    }
    return destination;
  }

  private write(stream: Writable, text: string): Promise<void> {
    return this.destination(stream).write(text);
  }

  async settle(): Promise<WriteState> {
    let drained = false;
    while (!drained) {
      const pending = [...this.destinations.values()].map((destination) => ({
        destination,
        tail: destination.tail,
      }));
      // A streamed message still open is output the run waits for, as a queued write is.
      const streams = [...this.streams].map((open) => handled(open.message.done));
      await Promise.all([...pending.map(({ tail }) => tail), ...streams]);
      // Node reports write errors after callbacks. Those callbacks can also enqueue output.
      await setImmediate();
      drained =
        this.streams.size === 0 &&
        pending.length === this.destinations.size &&
        pending.every(({ destination, tail }) => destination.tail === tail);
    }
    for (const destination of this.destinations.values()) {
      if (destination.state.kind === 'failed') {
        return destination.state;
      }
    }
    return { kind: 'ok' };
  }

  /**
   * Ends the run's output. A span still open, because a region's closing write never reached a
   * stderr that failed, closes here, so no span outlives its run.
   */
  dispose(): void {
    this.span?.finish();
    this.signal.removeEventListener('abort', this.onCancel);
    for (const destination of this.destinations.values()) {
      destination.dispose();
    }
  }
}

/**
 * The plain fallback path: a fresh destination on stderr, outside the invocation's queues and
 * outside every override, so no application code runs on it. The caller composes the newlines
 * between whatever it is reporting, then passes the one string this writes verbatim. A failed
 * write ends reporting.
 */
export async function reportPlainly(stderr: Writable, text: string): Promise<void> {
  try {
    const destination = new Destination(stderr);
    try {
      await destination.write(text);
    } finally {
      await setImmediate();
      destination.dispose();
    }
  } catch {
    // A failed fallback ends reporting; it never re-enters rendering.
  }
}
