import { Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';

import { FatalError, notTextReason, ResultError } from './errors.js';
import type { ResultFault } from './errors.js';
import type { ReportHost } from './host.js';
import { incompleteResult, lanes } from './lanes.js';
import type { IncompleteResult, Lane } from './lanes.js';
import type { LogDestination } from './log.js';
import { ProgressLedger } from './progress-events.js';
import { Regions, Screen } from './region.js';
import type { Frame, LiveRegion } from './region.js';
import { capabilities, columns, plainPolicy } from './rendering.js';
import type { RenderingPolicy } from './rendering.js';
import { writeSequence } from './sequence.js';
import type { SequenceView } from './sequence.js';
import { drawnRows, nextColumn, resolveText, width } from './style-resolve.js';
import type { Palette } from './style-state.js';
import { expandTabsMarked, wrapMarked } from './style-wrap.js';
import { createStyle, tokens } from './style.js';
import type {
  ActionChannel,
  OpenResult,
  Out,
  ProgressEvent,
  RegionCloser,
  ResultBinding,
  ResultView,
  RowView,
  View,
  ViewContext,
} from './types.js';
import { resolveRowView, resolveView, shapeOf } from './view.js';
import type { ViewRegistry } from './view.js';

function stringValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(notTextReason('view', value));
  }
  return value;
}

export type WriteState = { kind: 'ok' } | { kind: 'failed'; error: unknown };

/** The semantic calls, which choose a destination. A rendered value has no purpose of its own. */
type Purpose = Lane;

/** The two streams every write site names. */
type Stream = 'stdout' | 'stderr';

/** The threshold of a lane that writes at every verbosity. */
const always = Number.NEGATIVE_INFINITY;

/**
 * The lowest verbosity at which each lane writes: `info` and `success` from the default, so one
 * quiet step hides them, `debug` from `-v`, `trace` from `-vv`, and the rest at every verbosity.
 */
const shownFrom: Readonly<Record<Lane, number>> = {
  debug: 1,
  error: always,
  info: 0,
  print: always,
  success: 0,
  trace: 2,
  warn: always,
};

/** The opener a reservation holds until its own gate publishes the real one. */
const unopened = (): void => undefined;

/** One sequence's hold on a destination: the pieces it writes, and the end of its place. */
interface Reservation {
  write: (text: string) => Promise<void>;
  close: () => void;
}

/**
 * How a destination sends one text write once it reaches the stream: a terminal stderr erases the
 * live regions before it and draws them after it, and a terminal stdout does the same while a
 * region is open.
 */
type Passage = (text: string, send: (text: string) => Promise<void>) => Promise<void>;

/**
 * The turn the destinations on one terminal take to send. One send, with the region erase and
 * redraw around it, reaches the screen before the next one begins. A send waits only for sends
 * that have already begun, never for writes still queued, so a write held behind an open sequence
 * holds no other stream's send.
 */
class Turn {
  #last: Promise<void> = Promise.resolve();

  take(send: () => Promise<void>): Promise<void> {
    const pending = this.#last.then(send);
    this.#last = pending.catch(() => undefined);
    return pending;
  }
}

class Destination {
  tail: Promise<void> = Promise.resolve();
  state: WriteState = { kind: 'ok' };
  passage: Passage | undefined = undefined;
  /**
   * The destination whose order this one's text writes may join, if any, and whether a write issued
   * now joins it.
   */
  order: { shared: Destination; joins: () => boolean } | undefined = undefined;
  /** The turn this destination's sends take with the other destination on the same terminal. */
  turn: Turn | undefined = undefined;
  /** How many sequences hold a place in this destination's order and have not closed. */
  #sequences = 0;

  constructor(readonly stream: Writable) {
    stream.on('error', this.onError);
  }

  readonly onError = (error: unknown): void => {
    if (this.state.kind === 'ok') {
      this.state = { error, kind: 'failed' };
    }
  };

  /**
   * One text queued behind this destination's earlier writes and, when it joins another
   * destination's order, behind that one's too, which then waits for it in turn.
   */
  write(text: string): Promise<void> {
    const order = this.joined();
    const previous = order === undefined ? this.tail : Promise.all([this.tail, order.tail]);
    const pending = previous.then(() => this.accept(text));
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

  /** One text queued behind whatever preceded it, on a destination that has not failed. */
  private accept(text: string): Promise<void> {
    if (this.state.kind === 'failed') {
      throw this.state.error;
    }
    return this.send(() =>
      this.passage ? this.passage(text, (sent) => this.writeText(sent)) : this.writeText(text),
    );
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
   * sent as it is, outside the passage. Nothing is sent for the empty string.
   */
  compose(produce: () => string): Promise<void> {
    return this.run(() => {
      if (this.state.kind === 'failed') {
        throw this.state.error;
      }
      return this.send(() => {
        const text = produce();
        return text === '' ? Promise.resolve() : this.writeText(text);
      });
    });
  }

  /** Sends text now, inside an operation this destination is running, recording any failure. */
  async sendQuietly(text: string): Promise<void> {
    if (text === '' || this.state.kind === 'failed') {
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
        const pending = pieces.then(() => this.accept(text));
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
        reject(error);
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
            reject(error);
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

/** The sentence one view value of the wrong shape reports, which is the fault of its call. */
function shapeReason(both: boolean): string {
  return both
    ? 'The view carries render and row. Supply one of the two.'
    : 'The view carries neither render nor row. Supply a view with render or a row view with row.';
}

/**
 * No contributor at all. A result's selected view is replaced by view name alone, so the
 * Application's override list never reaches a result's views, which carry no identity.
 */
const bare: ViewRegistry = [];

/** The text a view produced, or the value that stands for its failure to produce text. */
function renderText(produce: () => unknown): { text: string } | { failed: unknown } {
  try {
    const text: unknown = produce();
    return typeof text === 'string' ? { text } : { failed: new Error(notTextReason('view', text)) };
  } catch (error) {
    return { failed: error };
  }
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as never;
}

/**
 * The sequences one channel has issued. An action that fails while one of them is still pending
 * stays primary, so its sequences are stopped rather than drained. A sequence that finished
 * already answers its own switch with nothing, so the set is never pruned.
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

/** Where one write goes, and the channel whose failure stops a sequence written there. */
interface Target {
  destination: Stream;
  live?: LiveSequences | undefined;
}

export class Output {
  private readonly destinations = new Map<Writable, Destination>();
  private renderFault: { cause: unknown } | undefined = undefined;
  // Every value a view failed with.
  // A caller that lets one propagate never offers it to a translator.
  private readonly viewFaults = new WeakSet();
  // Every fault the output path raised beside its calls, reported after the primary outcome.
  // A source a sequence stopped on and a results-lane fault are both such faults.
  private readonly stops: unknown[] = [];
  // The path routing walked, which an incomplete sequence names, updated as each name routes.
  private route: readonly string[] = [];
  /**
   * The channel every caller writes through. It is typed with the result left open, because the
   * declaration a call answers to is checked where the action was authored.
   */
  readonly out: Out<OpenResult>;
  /** The channel a configuration source receives: `out` with the results call naming a source. */
  readonly sourceOut: Out<OpenResult>;

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
  // Closes every region at once when the run's signal aborts.
  private readonly onCancel = (): void => {
    this.regions.closeAll('cancellation');
  };

  constructor(
    readonly host: ReportHost,
    private readonly signal: AbortSignal,
  ) {
    this.screen = new Screen({
      column: (shown, column) => nextColumn(shown, this.host.terminal.stderr.columns, column),
      rows: (marked) => this.frameRows(marked),
    });
    this.regions = new Regions(
      {
        cancelled: () => this.signal.aborted,
        frame: (data, view) => this.frame(data, view),
        ledger: new ProgressLedger({
          deliver: (event) => {
            this.progressObserver?.(event);
          },
          plain: (text) => this.context('stderr').plain(text),
        }),
        live: (input) => this.host.terminal.stderr.isTTY && (input || this.verbosity >= 0),
        write: (compose) => this.destination(this.host.stderr).compose(compose),
      },
      this.screen,
    );
    this.coordinate();
    signal.addEventListener('abort', this.onCancel, { once: true });
    this.out = {
      debug: (message) => this.emit('debug', message, 'stderr'),
      draw: (data: never, value: View<never>) => {
        const drawn = this.draw(data, value);
        // The row-count promise is a new boundary over the destination's observed write promise.
        void drawn.catch(() => undefined);
        return drawn;
      },
      error: (message) => this.emit('error', message, 'stderr'),
      fatal: (message) => {
        throw new FatalError(message);
      },
      info: (message) => this.emit('info', message, 'stderr'),
      print: (message) => this.emit('print', message, 'stdout'),
      // A region a middleware or a source opens closes once the chain has unwound.
      region: (options) => this.regions.open(options),
      // The data type is erased here, as it is in the registry.
      // One call dispatches on the shape of the view it was handed.
      // Every view function reads its data back through its own key.
      render: (data: never, value: View<never> | RowView<never>): Promise<void> =>
        this.renderValue(data, value, { destination: 'stdout' }),
      // Only the action emits a result, so this call is the middleware fault whatever was declared.
      results: () => this.resultFault('middleware'),
      success: (message) => this.emit('success', message, 'stderr'),
      trace: (message) => this.emit('trace', message, 'stderr'),
      warn: (message) => this.emit('warn', message, 'stderr'),
    };
    // A configuration source writes through the same channel, and its results call names it.
    this.sourceOut = { ...this.out, results: () => this.resultFault('source') };
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
      out: {
        ...this.out,
        print: (message) => this.emit('print', message, destination),
        region: (options) => this.regions.open(options, emission.regions),
        // The data type is erased here, as it is in the registry.
        // One call dispatches on the shape of the view it was handed.
        // Every view function reads its data back through its own key.
        render: (data: never, value: View<never> | RowView<never>): Promise<void> =>
          this.renderValue(data, value, target),
        results: (value) => this.results(binding, emission, value),
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
   * when none did. A call the declaration does not answer for is a fault of the lane and writes
   * nothing.
   */
  private results(binding: ResultBinding, emission: Emission, value: unknown): Promise<void> {
    const { path, result } = binding;
    if (!result) {
      return this.resultFault('undeclared', path);
    }
    if (emission.calls > 0) {
      return this.resultFault('repeated', path);
    }
    emission.calls += 1;
    const selected = binding.view ?? result.default;
    const view = result.views.get(selected);
    if (!view) {
      // Build proved the default names a view the record holds.
      // The boundary proved a selected name is one too, so this is core's own fault.
      return this.renderFailed(new Error(`The view "${selected}" is not declared.`));
    }
    if (result.kind === 'rows') {
      return this.sequence(erased(value), this.sequenceView(view, bare), {
        destination: 'stdout',
        live: emission.live,
      });
    }
    if (typeof view.row === 'function') {
      // The result() call rejects a row view on a value result, so reaching one here is core's own fault.
      return this.renderFailed(new Error(`The view "${selected}" renders rows, not a value.`));
    }
    return this.rendered(() => resolveView(bare, view)(erased(value), this.context('stdout')));
  }

  /**
   * One fault of the results lane: the call rejects, and the same failure is reported after this
   * invocation's primary outcome, so a call the action never awaited still turns a would-be 0 into
   * 1 and one the action let propagate is reported once.
   */
  private resultFault(kind: ResultFault, path: readonly string[] = this.route): Promise<void> {
    const fault = new ResultError(kind, path);
    this.stops.push(fault);
    const rejected = Promise.reject(fault);
    void rejected.catch(() => undefined);
    return rejected;
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
   * Closes every live region still open, or waiting to open: with `'completion'` once the
   * middleware chain has unwound, and with `'failure'` before any failure report renders, so each
   * region's last frame is written above it.
   */
  closeRegions(closer: RegionCloser): void {
    this.regions.closeAll(closer);
  }

  /**
   * The destination an `onLog` hook writes to, with its stderr carried through this run's stderr
   * order when that stream is a terminal, so a hook's line lands above the open regions. Each
   * chunk joins stderr's order when the hook writes it and is acknowledged at once, so records a
   * hook writes together stay together, ahead of any write core queues after them.
   */
  logDestination(destination: LogDestination): LogDestination {
    const { stderr } = destination;
    if (stderr !== this.host.stderr || !this.host.terminal.stderr.isTTY) {
      return destination;
    }
    const carried = new Writable({
      write: (chunk: unknown, _encoding, done) => {
        // The stream's own failure is the run's, recorded where the write was queued.
        void this.write(stderr, String(chunk)).catch(() => undefined);
        done();
      },
    });
    return Object.freeze({ ...destination, stderr: carried });
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
      return;
    }
    const errors = this.destination(stderr);
    errors.passage = (text, send) => {
      const { after, before } = this.screen.around(text);
      return send(before + text + after);
    };
    if (!terminal.stdout.isTTY || stdout === stderr) {
      return;
    }
    const output = this.destination(stdout);
    const turn = new Turn();
    errors.turn = turn;
    output.turn = turn;
    output.order = { joins: () => this.screen.holding, shared: errors };
    output.passage = async (text, send) => {
      if (!this.screen.holding) {
        this.screen.note(text);
        return send(text);
      }
      const { after, before } = this.screen.around(text);
      await errors.sendQuietly(before);
      try {
        await send(text);
      } finally {
        await errors.sendQuietly(after);
      }
      return undefined;
    };
  }

  /** The rows a frame's marked text takes at stderr's current width, counted as it resolves. */
  private frameRows(marked: string): number {
    return drawnRows(marked, {
      caps: this.drawCaps(),
      columns: this.host.terminal.stderr.columns,
      palette: this.palette,
    });
  }

  /** The capabilities a drawn frame resolves under: stderr's, with its controls kept at a terminal. */
  private drawCaps() {
    const caps = capabilities(this.host, 'stderr', this.policy);
    caps.terminalControls ||= this.host.terminal.stderr.isTTY;
    return caps;
  }

  /**
   * One frame of a region or of `out.draw`: the view runs inside the call with stderr's context,
   * its marked text is kept so the frame's rows can be counted now and recounted at a later width,
   * and a view of the wrong shape or one that breaks is this call's output-view fault.
   */
  private frame(data: unknown, value: View<never>): Frame | { failed: Promise<void> } {
    const shape = shapeOf(value);
    if (shape !== 'render') {
      return {
        failed: this.renderFailed(
          new Error(
            shape === 'row'
              ? 'The view carries row. Supply a view with render.'
              : shapeReason(shape === 'both'),
          ),
        ),
      };
    }
    try {
      const marked = stringValue(
        resolveView(this.registry, value)(erased(data), this.context('stderr')),
      );
      return { marked, text: resolveText(marked, this.palette, this.drawCaps()) };
    } catch (error) {
      return { failed: this.renderFailed(error) };
    }
  }

  /** What this invocation's output raised beside its calls, in the order it was raised. */
  get stopped(): readonly unknown[] {
    return this.stops;
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
      width: (text: string) => width(text, this.palette, caps),
      wrap: (text: string, limit: number | undefined) => wrapMarked(text, limit, { caps, palette }),
    });
  }

  /**
   * A semantic message is one line on its destination; only `print` writes to stdout. The message
   * is checked before the lane view runs, and this call appends the one newline after it, so a
   * lane view returns none and an override that returns the empty string still writes one. A call
   * the run's verbosity hides is checked the same way, then calls no lane view and writes nothing.
   */
  emit(kind: Purpose, message: string, destination: Stream): Promise<void> {
    if (typeof message === 'string' && this.verbosity < shownFrom[kind]) {
      return Promise.resolve();
    }
    return this.rendered(() => {
      if (typeof message !== 'string') {
        throw new TypeError('Output messages must be strings.');
      }
      const render = resolveView<string>(this.registry, lanes[kind]);
      return `${stringValue(render(message, this.context(destination)))}\n`;
    }, destination);
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
   * output, so an override that returns the empty string silences it and one that throws is a view
   * fault. A stderr that has failed already takes the plain fallback path and no further. It answers
   * the view fault these lines raised when the run had raised none before, which the run reports
   * only when nothing else failed.
   */
  async writeIncomplete(): Promise<{ cause: unknown } | undefined> {
    const earlier = this.renderFault;
    for (const facts of this.heldIncomplete.splice(0)) {
      const context = this.context('stderr');
      const failed = this.destinations.get(this.host.stderr)?.state.kind === 'failed';
      await (failed
        ? reportPlainly(this.host.stderr, incompleteResult.render(facts, context))
        : this.rendered(
            () => resolveView(this.registry, incompleteResult)(facts, context),
            'stderr',
          ).catch(() => undefined));
    }
    return earlier === undefined ? this.renderFault : undefined;
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
    const frame = this.frame(data, value);
    if ('failed' in frame) {
      await frame.failed;
      return 0;
    }
    const rows = this.frameRows(frame.marked);
    await this.write(this.host.stderr, frame.text);
    return rows;
  }

  /**
   * One `out.render` call, dispatched on the shape of the view it was handed. The two shapes are
   * exclusive, so a JavaScript author's value that carries both, or neither, is the output-view
   * fault of this call and nothing is written for it.
   */
  private renderValue(
    data: never,
    value: View<never> | RowView<never>,
    target: Target,
  ): Promise<void> {
    const shape = shapeOf(value);
    if (shape === 'both' || shape === 'neither') {
      return this.renderFailed(new Error(shapeReason(shape === 'both')));
    }
    // The shape was named above, so this second read narrows the value rather than deciding it.
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
        this.stops.push(cause);
      },
      view,
    });
    // A sequence its own channel can stop, so an action's failure ends it rather than draining it.
    target.live?.add(sequence.stop);
    void sequence.pending.catch(() => undefined);
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
   * throw or a non-string return rejects this call alone: nothing is written for it, later output
   * still writes, and the recorded cause ends the invocation once the action has completed.
   */
  private rendered(
    produce: () => unknown,
    destination: Stream = 'stdout',
    write?: (text: string) => Promise<void>,
  ): Promise<void> {
    const rendered = renderText(() =>
      resolveText(
        stringValue(produce()),
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
   * The rejected call. The first view failure is the reported one, so a later one adds no
   * second diagnostic, and the rejection is observed here as well, because an action that never
   * awaits the call must not end the process with an unhandled rejection.
   */
  private renderFailed(cause: unknown): Promise<void> {
    this.renderFault ??= { cause };
    if ((typeof cause === 'object' || typeof cause === 'function') && cause !== null) {
      this.viewFaults.add(cause);
    }
    const rejection = Promise.reject(cause);
    void rejection.catch(() => undefined);
    return rejection;
  }

  /**
   * Whether one value is what a view or a message check failed with during this invocation. A
   * broken view is a defect in the code that broke the view contract, so an action or a source that
   * lets its rejection propagate reports it as that defect.
   */
  raisedByView(value: unknown): boolean {
    return (
      (typeof value === 'object' || typeof value === 'function') &&
      value !== null &&
      this.viewFaults.has(value)
    );
  }

  /** What a view failed with during this invocation, if one did. */
  get fault(): { cause: unknown } | undefined {
    return this.renderFault;
  }

  /** The queue one stream writes through, opened the first time this invocation reaches it. */
  private destination(stream: Writable): Destination {
    let destination = this.destinations.get(stream);
    if (!destination) {
      destination = new Destination(stream);
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
      await Promise.all(pending.map(({ tail }) => tail));
      // Node reports write errors after callbacks. Those callbacks can also enqueue output.
      await setImmediate();
      drained =
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

  dispose(): void {
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
