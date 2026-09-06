import type { Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';

import { FatalError } from './errors.js';
import type { Host, Out } from './types.js';

type WriteState = { kind: 'ok' } | { kind: 'failed'; error: unknown };
type Purpose =
  | 'print'
  | 'info'
  | 'success'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'internal'
  | 'declaration'
  | 'input';

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

export class Output {
  private readonly destinations = new Map<Writable, Destination>();
  readonly out: Out;

  constructor(readonly host: Pick<Host, 'stdout' | 'stderr'>) {
    this.out = {
      error: (message) => this.emit('error', message),
      fatal: (message) => {
        throw new FatalError(message);
      },
      info: (message) => this.emit('info', message),
      print: (message) => this.emit('print', message),
      success: (message) => this.emit('success', message),
      warn: (message) => this.emit('warn', message),
    };
  }

  emit(kind: Purpose, message: string): Promise<void> {
    const stream = kind === 'print' ? this.host.stdout : this.host.stderr;
    let destination = this.destinations.get(stream);
    if (!destination) {
      destination = new Destination(stream);
      this.destinations.set(stream, destination);
    }
    return destination.write(`${message}\n`);
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

export async function reportOutputFailure(stderr: Writable): Promise<void> {
  const destination = new Destination(stderr);
  try {
    await destination.write('Internal error: Could not write invocation output.\n');
  } catch {
    // A failed fallback ends reporting; it never re-enters rendering.
  } finally {
    await setImmediate();
    destination.dispose();
  }
}
