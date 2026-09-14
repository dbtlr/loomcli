import type { Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';

import { FatalError, notTextReason } from './errors.js';
import { lanes } from './lanes.js';
import type { Lane } from './lanes.js';
import { capabilities } from './rendering.js';
import type { RenderingPolicy } from './rendering.js';
import { resolveText, width } from './style-resolve.js';
import type { Palette } from './style-state.js';
import { createStyle, tokens } from './style.js';
import type { Host, Out, View, ViewContext } from './types.js';
import { resolveView } from './view.js';
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
    const pending = this.tail.then(() => {
      if (this.state.kind === 'failed') {
        throw this.state.error;
      }
      return this.writeText(text);
    });
    // Keep the returned rejection observable, while accounting for calls without await.
    this.tail = pending.catch(this.onError);
    return pending;
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

/** The text a view produced, or the value that stands for its failure to produce text. */
function renderText(produce: () => unknown): { text: string } | { failed: unknown } {
  try {
    const text: unknown = produce();
    return typeof text === 'string' ? { text } : { failed: new Error(notTextReason(text)) };
  } catch (error) {
    return { failed: error };
  }
}

export class Output {
  private readonly destinations = new Map<Writable, Destination>();
  private renderFault: { cause: unknown } | undefined = undefined;
  readonly out: Out;

  private palette: Palette = new Map();
  private policy: RenderingPolicy = {};
  // The contributors this invocation resolves a declared view through, published once they build.
  private registry: ViewRegistry = [];
  style = createStyle();

  constructor(readonly host: Host) {
    this.out = {
      error: (message) => this.emit('error', message),
      fatal: (message) => {
        throw new FatalError(message);
      },
      info: (message) => this.emit('info', message),
      print: (message) => this.emit('print', message),
      render: <Data>(data: Data, value: View<Data>): Promise<void> =>
        this.rendered(() => resolveView(this.registry, value)(data, this.context('stdout'))),
      success: (message) => this.emit('success', message),
      warn: (message) => this.emit('warn', message),
    };
  }

  /** The registry one invocation resolves through, republished as each contributor is read. */
  useViews(registry: ViewRegistry): void {
    this.registry = registry;
  }

  configure(policy: RenderingPolicy, palette: Palette): void {
    this.policy = policy;
    this.palette = palette;
    this.style = createStyle(new Set([...tokens, ...palette.keys()]));
  }

  context(destination: 'stdout' | 'stderr'): ViewContext {
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
   * The write site owns its newline; core resolves the view's marked text before queuing it. A
   * throw or a non-string return rejects this call alone: nothing is written for it, later output
   * still writes, and the recorded cause ends the invocation once the action has completed.
   */
  private rendered(
    produce: () => unknown,
    destination: 'stdout' | 'stderr' = 'stdout',
  ): Promise<void> {
    const rendered = renderText(() =>
      resolveText(
        stringValue(produce()),
        this.palette,
        capabilities(this.host, destination, this.policy),
      ),
    );
    return 'text' in rendered
      ? this.write(this.host[destination], rendered.text)
      : this.renderFailed(rendered.failed);
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

  private write(stream: Writable, text: string): Promise<void> {
    let destination = this.destinations.get(stream);
    if (!destination) {
      destination = new Destination(stream);
      this.destinations.set(stream, destination);
    }
    return destination.write(text);
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
