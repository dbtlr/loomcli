import type { Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';

import { FatalError } from './errors.js';
import type { Host, Out, Renderer } from './types.js';

type WriteState = { kind: 'ok' } | { kind: 'failed'; error: unknown };

/** The semantic calls, which choose a destination. A rendered value has no purpose of its own. */
type Purpose = 'print' | 'info' | 'success' | 'warn' | 'error';

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

/** The text a renderer produced, or the value that stands for its failure to produce text. */
function renderText(produce: () => unknown): { text: string } | { failed: unknown } {
  try {
    const text: unknown = produce();
    return typeof text === 'string'
      ? { text }
      : { failed: new Error(`The renderer returned ${typeof text} instead of a string.`) };
  } catch (error) {
    return { failed: error };
  }
}

export class Output {
  private readonly destinations = new Map<Writable, Destination>();
  private renderFault: { cause: unknown } | undefined = undefined;
  readonly out: Out;

  constructor(readonly host: Pick<Host, 'stdout' | 'stderr'>) {
    this.out = {
      error: (message) => this.emit('error', message),
      fatal: (message) => {
        throw new FatalError(message);
      },
      info: (message) => this.emit('info', message),
      print: (message) => this.emit('print', message),
      render: <Data>(data: Data, renderer: Renderer<Data>): Promise<void> =>
        this.rendered(() => renderer.render(data)),
      success: (message) => this.emit('success', message),
      warn: (message) => this.emit('warn', message),
    };
  }

  /** A semantic message is one line on its destination; only `print` writes to stdout. */
  emit(kind: Purpose, message: string): Promise<void> {
    return this.write(kind === 'print' ? this.host.stdout : this.host.stderr, `${message}\n`);
  }

  /**
   * The failure report of one invocation. Like `render`, the text is queued on its destination
   * exactly as given: the caller already carries its own trailing newline, whether that text came
   * from a registered renderer or from core's own default text.
   */
  report(text: string): Promise<void> {
    return this.write(this.host.stderr, text);
  }

  /**
   * The renderer owns every byte, so its text is queued on stdout exactly as returned. A throw or
   * a non-string return rejects this call alone: nothing is written for it, later output still
   * writes, and the recorded cause ends the invocation once the action has completed.
   */
  private rendered(produce: () => unknown): Promise<void> {
    const rendered = renderText(produce);
    return 'text' in rendered
      ? this.write(this.host.stdout, rendered.text)
      : this.renderFailed(rendered.failed);
  }

  /**
   * The rejected call. The first renderer failure is the reported one, so a later one adds no
   * second diagnostic, and the rejection is observed here as well, because an action that never
   * awaits the call must not end the process with an unhandled rejection.
   */
  private renderFailed(cause: unknown): Promise<void> {
    this.renderFault ??= { cause };
    const rejection = Promise.reject(cause);
    void rejection.catch(() => undefined);
    return rejection;
  }

  /** What a renderer failed with during this invocation, if one did. */
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
 * outside every registration, so no application code runs on it. The caller composes the newlines
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
