import { StringDecoder } from 'node:string_decoder';

import { invalid } from './link.js';
import type { PromptContext } from './types.js';

type Key =
  | { kind: 'text'; value: string }
  | { kind: 'enter' | 'backspace' | 'up' | 'down' | 'cancel' | 'eof' };
interface InputQueue {
  keys: Key[];
  decoder: StringDecoder;
  pending: string;
  carriage: boolean;
}
/** Typeahead belongs to the run, not a question, and becomes unreachable once the run ends. */
const queues = new WeakMap<AbortSignal, InputQueue>();

/** Splits UTF-8 and terminal escape sequences across chunks without losing typed-ahead answers. */
function feed(queue: InputQueue, chunk: Buffer | string): void {
  queue.pending += typeof chunk === 'string' ? chunk : queue.decoder.write(chunk);
  while (queue.pending !== '') {
    if (queue.pending.startsWith('\u001b')) {
      if (queue.pending.length === 1) {
        return;
      }
      // Terminal escape sequences contain the ESC protocol character.
      // oxlint-disable-next-line eslint/no-control-regex
      const sequence = /^(?:\u001b\[[0-?]*[ -/]*[@-~]|\u001bO.)/u.exec(queue.pending)?.[0];
      if (
        sequence === undefined &&
        (queue.pending.startsWith('\x1B[') || queue.pending === '\u001bO')
      ) {
        return;
      }
      queue.pending = queue.pending.slice(sequence?.length ?? 1);
      if (sequence === '\u001b[A' || sequence === '\u001bOA') {
        queue.keys.push({ kind: 'up' });
      }
      if (sequence === '\u001b[B' || sequence === '\u001bOB') {
        queue.keys.push({ kind: 'down' });
      }
      queue.carriage = false;
      continue;
    }
    const codePoint = queue.pending.codePointAt(0);
    if (codePoint === undefined) {
      return;
    }
    const character = String.fromCodePoint(codePoint);
    queue.pending = queue.pending.slice(character.length);
    if (character === '\n' && queue.carriage) {
      queue.carriage = false;
      continue;
    }
    queue.carriage = character === '\r';
    if (character === '\r' || character === '\n') {
      queue.keys.push({ kind: 'enter' });
    } else if (character === '\u0003') {
      queue.keys.push({ kind: 'cancel' });
    } else if (character === '\u0004') {
      queue.keys.push({ kind: 'eof' });
    } else if (character === '\u007f' || character === '\b') {
      queue.keys.push({ kind: 'backspace' });
    } else if (character >= ' ') {
      queue.keys.push({ kind: 'text', value: character });
    }
  }
}

/** Brackets raw mode and listeners; abort restores cooked mode synchronously. */
export function openReader<Options>(context: PromptContext<Options>) {
  context.signal.throwIfAborted();
  const input = context.host.stdin;
  if (!('setRawMode' in input) || typeof input.setRawMode !== 'function') {
    invalid(
      'Interactive stdin has no setRawMode method.',
      'Supply a terminal stream with setRawMode.',
    );
  }
  const raw = input.setRawMode.bind(input);
  const queue = queues.get(context.signal) ?? {
    carriage: false,
    decoder: new StringDecoder('utf8'),
    keys: [],
    pending: '',
  };
  queues.set(context.signal, queue);
  let waiting: { resolve: (key: Key) => void; reject: (error: unknown) => void } | undefined =
    undefined;
  let failure: { error: unknown } | undefined = undefined;
  let closed = false;
  const settle = () => {
    const key = queue.keys.shift();
    if (waiting && key) {
      const current = waiting;
      waiting = undefined;
      current.resolve(key);
    } else if (key) {
      queue.keys.unshift(key);
    }
  };
  const data = (chunk: Buffer | string) => {
    feed(queue, chunk);
    if (queue.keys.some((key) => key.kind === 'cancel')) {
      context.cancel();
    }
    settle();
  };
  const end = () => {
    context.cancel();
  };
  const inputError = (cause: unknown) => {
    failure = { error: cause };
    const current = waiting;
    waiting = undefined;
    close();
    current?.reject(cause);
  };
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    raw(false);
    input.pause();
    input.off('data', data).off('end', end).off('close', end).off('error', inputError);
    context.signal.removeEventListener('abort', abort);
  };
  const abort = () => {
    close();
    queues.delete(context.signal);
    const current = waiting;
    waiting = undefined;
    current?.reject(context.signal.reason);
  };
  context.signal.addEventListener('abort', abort, { once: true });
  try {
    raw(true);
    input.on('data', data).once('end', end).once('close', end).once('error', inputError);
    input.resume();
    if (input.readableEnded || input.destroyed) {
      context.cancel();
    }
  } catch (error) {
    close();
    throw error;
  }
  return {
    close,
    async read(): Promise<Key> {
      context.signal.throwIfAborted();
      if (failure) {
        throw failure.error;
      }
      const key = queue.keys.shift();
      if (key) {
        return key;
      }
      return new Promise<Key>((resolve, reject) => {
        waiting = { reject, resolve };
      });
    },
  };
}
