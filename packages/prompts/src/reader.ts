import { StringDecoder } from 'node:string_decoder';

import { raiseInterruptKeys } from '@loomcli/core';

import type { PromptContext } from './types.js';

type Key =
  | { kind: 'text'; value: string }
  | { kind: 'enter' | 'backspace' | 'up' | 'down' | 'eof' };

/** The control sequence that shows the terminal's cursor. */
const showCursor = '\u001b[?25h';
interface InputQueue {
  keys: Key[];
  decoder: StringDecoder;
  pending: string;
  carriage: boolean;
}
/** Typeahead belongs to the run, not a question, and becomes unreachable once the run ends. */
const queues = new WeakMap<AbortSignal, InputQueue>();

/** Splits terminal escape sequences across reads without losing typed-ahead answers. */
function feed(queue: InputQueue, text: string): void {
  queue.pending += text;
  while (queue.pending !== '') {
    if (queue.pending.startsWith('\u001b')) {
      if (queue.pending.length === 1) {
        return;
      }
      // Terminal escape sequences contain the ESC protocol character.
      // oxlint-disable-next-line eslint/no-control-regex
      const sequence = /^(?:\u001b\[[0-?]*[ -/]*[@-~]|\u001bO[@-~])/u.exec(queue.pending)?.[0];
      const incompleteCsi =
        queue.pending.startsWith('\u001b[') && /^[0-?]*[ -/]*$/u.test(queue.pending.slice(2));
      if (sequence === undefined && (incompleteCsi || queue.pending === '\u001bO')) {
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
    } else if (character === '\u0004') {
      queue.keys.push({ kind: 'eof' });
    } else if (character === '\u007f' || character === '\b') {
      queue.keys.push({ kind: 'backspace' });
    } else if (character >= ' ') {
      queue.keys.push({ kind: 'text', value: character });
    }
  }
}

/**
 * One run's hold on stdin while any of its questions is open: raw mode, the listeners that feed
 * the run's key queue, and the one read waiting for a key. Two questions open at once share it, so
 * every chunk is fed once, and the question whose input region is open reads its keys in order.
 */
interface Session {
  queue: InputQueue;
  readers: number;
  waiting: { resolve: (key: Key) => void; reject: (error: unknown) => void } | undefined;
  failure: { error: unknown } | undefined;
  release: () => void;
}
const sessions = new WeakMap<AbortSignal, Session>();

/**
 * Registers the run's handlers that restore the terminal while raw mode holds: a shutdown leaves
 * raw mode and shows the cursor, a suspend leaves raw mode before the process stops, and the resume
 * enters it again. Answers the call that removes them.
 */
function restoring<Options>(
  context: PromptContext<Options>,
  raw: (mode: boolean) => unknown,
): () => void {
  const removers = [
    context.onShutdown(() => {
      raw(false);
      if (context.host.terminal.stderr.isTTY) {
        context.host.stderr.write(showCursor);
      }
    }),
    context.onSuspend(() => {
      raw(false);
    }),
    context.onResume(() => {
      raw(true);
    }),
  ];
  return () => {
    for (const remove of removers) {
      remove();
    }
  };
}

/** Enters raw mode and feeds the run's queue until the last reader closes or the run aborts. */
function holdInput<Options>(context: PromptContext<Options>, queue: InputQueue): Session {
  const input = context.host.stdin;
  if (!('setRawMode' in input) || typeof input.setRawMode !== 'function') {
    throw new TypeError('Interactive stdin has no setRawMode method.');
  }
  const raw = input.setRawMode.bind(input);
  let released = false;
  let unregister: (() => void) | undefined = undefined;
  const session: Session = {
    failure: undefined,
    queue,
    readers: 0,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      unregister?.();
      sessions.delete(context.signal);
      raw(false);
      input.pause();
      input.off('data', data).off('end', end).off('close', end).off('error', inputError);
      context.signal.removeEventListener('abort', abort);
    },
    waiting: undefined,
  };
  const settle = () => {
    const key = queue.keys.shift();
    if (session.waiting && key) {
      const current = session.waiting;
      session.waiting = undefined;
      current.resolve(key);
    } else if (key) {
      queue.keys.unshift(key);
    }
  };
  // A raised interrupt drops every key still unread, as a cooked terminal flushes its input.
  // That includes part of a key or a character held from an earlier read, so no key answers the question before the signal arrives.
  // After Ctrl-C or Ctrl-\ every later key is dropped too, until the run's abort.
  // After Ctrl-Z the question reads on once the process resumes.
  let interrupted = false;
  const data = (chunk: Buffer | string) => {
    if (interrupted) {
      return;
    }
    const { raised, rest } = raiseInterruptKeys(
      context,
      typeof chunk === 'string' ? chunk : queue.decoder.write(chunk),
    );
    if (raised !== undefined) {
      interrupted = raised === 'ending';
      queue.keys.length = 0;
      queue.pending = '';
      queue.carriage = false;
      queue.decoder = new StringDecoder('utf8');
      return;
    }
    feed(queue, rest);
    settle();
  };
  const end = () => {
    context.cancel();
  };
  const inputError = (cause: unknown) => {
    session.failure = { error: cause };
    const current = session.waiting;
    session.waiting = undefined;
    session.release();
    current?.reject(cause);
  };
  const abort = () => {
    session.release();
    queues.delete(context.signal);
    const current = session.waiting;
    session.waiting = undefined;
    current?.reject(context.signal.reason);
  };
  context.signal.addEventListener('abort', abort, { once: true });
  try {
    raw(true);
    unregister = restoring(context, raw);
    input.on('data', data).once('end', end).once('close', end).once('error', inputError);
    input.resume();
    if (input.readableEnded || input.destroyed) {
      context.cancel();
    }
  } catch (error) {
    session.release();
    throw error;
  }
  sessions.set(context.signal, session);
  return session;
}

/**
 * Brackets raw mode and listeners for one question; abort restores cooked mode synchronously.
 * Raw mode holds while any question of the run is open, so a key typed for a question still
 * waiting its turn never reaches a cooked terminal.
 */
export function openReader<Options>(context: PromptContext<Options>) {
  context.signal.throwIfAborted();
  const queue = queues.get(context.signal) ?? {
    carriage: false,
    decoder: new StringDecoder('utf8'),
    keys: [],
    pending: '',
  };
  queues.set(context.signal, queue);
  const session = sessions.get(context.signal) ?? holdInput(context, queue);
  session.readers += 1;
  let closed = false;
  let abandoned: { reason: unknown } | undefined = undefined;
  let mine: Session['waiting'] = undefined;
  return {
    /**
     * Ends this question's reading with `reason`: its pending read rejects, and so does every later
     * one, so the question leaves through its own path out and closes the reader there.
     */
    abandon(reason: unknown) {
      if (closed || abandoned !== undefined) {
        return;
      }
      abandoned = { reason };
      if (mine !== undefined && session.waiting === mine) {
        session.waiting = undefined;
        mine.reject(reason);
      }
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      session.readers -= 1;
      if (session.readers === 0) {
        session.release();
      }
    },
    async read(): Promise<Key> {
      context.signal.throwIfAborted();
      if (abandoned !== undefined) {
        throw abandoned.reason;
      }
      if (session.failure) {
        throw session.failure.error;
      }
      const key = queue.keys.shift();
      if (key) {
        return key;
      }
      return new Promise<Key>((resolve, reject) => {
        mine = { reject, resolve };
        session.waiting = mine;
      });
    },
  };
}
