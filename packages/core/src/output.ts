import type { Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';

import { FatalError, notTextReason } from './errors.js';
import { incompleteResult, lanes } from './lanes.js';
import type { IncompleteResult, Lane } from './lanes.js';
import { capabilities } from './rendering.js';
import type { RenderingPolicy } from './rendering.js';
import { writeSequence } from './sequence.js';
import { resolveText, width } from './style-resolve.js';
import type { Palette } from './style-state.js';
import { createStyle, tokens } from './style.js';
import type { Host, OpenResult, Out, RowView, View, ViewContext } from './types.js';
import { resolveRowView, resolveView } from './view.js';
import type { ViewRegistry } from './view.js';

function stringValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(notTextReason(value));
  }
  return value;
}

type WriteState = { kind: 'ok' } | { kind: 'failed'; error: unknown };

/** The semantic calls, which choose a destination. A rendered value has no purpose of its own. */
type Purpose = Lane;

/** The two streams every write site names. */
type Stream = 'stdout' | 'stderr';

/** The opener a reservation holds until its own gate publishes the real one. */
const unopened = (): void => undefined;

/** One sequence's hold on a destination: the pieces it writes, and the end of its place. */
interface Reservation {
  write: (text: string) => Promise<void>;
  close: () => void;
}

class Destination {
  tail: Promise<void> = Promise.resolve();
  state: WriteState = { kind: 'ok' };

  constructor(readonly stream: Writable) {
    stream.on('error', this.onError);
  }

  readonly onError = (error: unknown): void => {
    if (this.state.kind === 'ok') {
      this.state = { error, kind: 'failed' };
    }
  };

  write(text: string): Promise<void> {
    const pending = this.tail.then(() => this.accept(text));
    // Keep the returned rejection observable, while accounting for calls without await.
    this.tail = pending.catch(this.onError);
    return pending;
  }

  /** One text queued behind whatever preceded it, on a destination that has not failed. */
  private accept(text: string): Promise<void> {
    if (this.state.kind === 'failed') {
      throw this.state.error;
    }
    return this.writeText(text);
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
    // The sequence's own pieces queue on each other, ahead of the gate that holds its place.
    let pieces = previous;
    return {
      close: () => {
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

/** The text a view produced, or the value that stands for its failure to produce text. */
function renderText(produce: () => unknown): { text: string } | { failed: unknown } {
  try {
    const text: unknown = produce();
    return typeof text === 'string' ? { text } : { failed: new Error(notTextReason(text)) };
  } catch (error) {
    return { failed: error };
  }
}

/**
 * The result channel before the lane emits. It rejects rather than writing, and it observes its own
 * rejection, so a caller that never awaits the call still leaves the process alone.
 */
function emptyLane(): Promise<void> {
  const rejected = Promise.reject(new Error('The results lane does not emit yet.'));
  void rejected.catch(() => undefined);
  return rejected;
}

export class Output {
  private readonly destinations = new Map<Writable, Destination>();
  private renderFault: { cause: unknown } | undefined = undefined;
  // Every source failure a sequence stopped on, reported after this invocation's primary outcome.
  private readonly stops: unknown[] = [];
  // The routed Command an incomplete sequence names, published once routing resolved it.
  private route: readonly string[] = [];
  /**
   * The channel every caller writes through. It is typed with the result left open, because the
   * declaration a call answers to is checked where the action was authored.
   */
  readonly out: Out<OpenResult>;

  private palette: Palette = new Map();
  private policy: RenderingPolicy = {};
  // The contributors this invocation resolves a declared view through, published once they build.
  private registry: ViewRegistry = [];
  style = createStyle();

  constructor(
    readonly host: Host,
    private readonly signal: AbortSignal,
  ) {
    this.out = {
      error: (message) => this.emit('error', message),
      fatal: (message) => {
        throw new FatalError(message);
      },
      info: (message) => this.emit('info', message),
      print: (message) => this.emit('print', message),
      // The data type is erased here, as it is in the registry: one call dispatches on the shape of
      // The view it was handed, and every view function reads its data back through its own key.
      render: (data: never, value: View<never> | RowView<never>): Promise<void> =>
        this.renderValue(data, value),
      results: () => emptyLane(),
      success: (message) => this.emit('success', message),
      warn: (message) => this.emit('warn', message),
    };
  }

  /** The registry one invocation resolves through, republished as each contributor is read. */
  useViews(registry: ViewRegistry): void {
    this.registry = registry;
  }

  /** The routed path, published once routing resolved it, which an incomplete sequence names. */
  useRoute(path: readonly string[]): void {
    this.route = path;
  }

  /** What a sequence's source failed with during this invocation, in the order they stopped. */
  get stopped(): readonly unknown[] {
    return this.stops;
  }

  configure(policy: RenderingPolicy, palette: Palette): void {
    this.policy = policy;
    this.palette = palette;
    this.style = createStyle(new Set([...tokens, ...palette.keys()]));
  }

  context(destination: Stream): ViewContext {
    const caps = capabilities(this.host, destination, this.policy);
    return Object.freeze({
      style: this.style,
      width: (text: string) => width(text, this.palette, caps),
    });
  }

  /**
   * A semantic message is one line on its destination; only `print` writes to stdout. The message
   * is checked before the lane view runs, and this call appends the one newline after it, so a
   * lane view returns none and an override that returns the empty string still writes one.
   */
  emit(kind: Purpose, message: string): Promise<void> {
    const destination = kind === 'print' ? 'stdout' : 'stderr';
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
   * One `out.render` call, dispatched on the shape of the view it was handed. The two shapes are
   * exclusive, so a JavaScript author's value that carries both, or neither, is the output-view
   * fault of this call and nothing is written for it.
   */
  private renderValue(data: never, value: View<never> | RowView<never>): Promise<void> {
    const rows = typeof value.row === 'function';
    if (rows === (typeof value.render === 'function')) {
      return this.renderFailed(new Error(shapeReason(rows)));
    }
    if (typeof value.row === 'function') {
      return this.sequence(data, value, 'stdout');
    }
    return this.rendered(() => resolveView(this.registry, value)(data, this.context('stdout')));
  }

  /**
   * One sequence, which holds its place on the destination from here until its last piece is
   * written. The returned rejection is observed here as well, because an action that never awaits
   * the call must not end the process with an unhandled rejection.
   */
  private sequence(source: never, value: RowView<never>, destination: Stream): Promise<void> {
    const place = this.destination(this.host[destination]).reserve();
    const pending = writeSequence({
      close: place.close,
      context: this.context(destination),
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
      view: resolveRowView(this.registry, value),
    });
    void pending.catch(() => undefined);
    return pending;
  }

  /**
   * The line one incomplete sequence writes on stderr, ahead of the fault's own report. It resolves
   * through the registry like any other rendered output, so an override that returns the empty
   * string silences it and one that throws is a view fault. A stderr that has failed already takes
   * the plain fallback path and no further.
   */
  private incomplete(facts: IncompleteResult): void {
    const context = this.context('stderr');
    if (this.destinations.get(this.host.stderr)?.state.kind === 'failed') {
      void reportPlainly(this.host.stderr, incompleteResult.render(facts, context));
      return;
    }
    void this.rendered(
      () => resolveView(this.registry, incompleteResult)(facts, context),
      'stderr',
    ).catch(() => undefined);
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
    const rejection = Promise.reject(cause);
    void rejection.catch(() => undefined);
    return rejection;
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
