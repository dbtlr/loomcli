import { StringDecoder } from 'node:string_decoder';

import { raiseInterruptKeys } from '@loomcli/core';

import { controls, hideCursor, pasteOff, pasteOn, showCursor } from './controls.js';
import type { PromptContext } from './types.js';

type Key =
  | { kind: 'text' | 'paste'; value: string }
  | {
      kind:
        | 'enter'
        | 'backspace'
        | 'up'
        | 'down'
        | 'eof'
        | 'left'
        | 'right'
        | 'home'
        | 'end'
        | 'delete'
        | 'wordLeft'
        | 'wordRight'
        | 'killWord'
        | 'killWhitespace'
        | 'killStart'
        | 'killEnd'
        | 'tab';
    };

/** The milliseconds within which a read continues an ESC that ended the read before it. */
const escapeWindow = 50;

interface InputQueue {
  keys: Key[];
  decoder: StringDecoder;
  pending: string;
  carriage: boolean;
  paste: string | undefined;
  read: number;
  pendingRead: number;
  /** When the ESC that ends `pending` was held, on the `performance.now()` clock. */
  held: number | undefined;
  /** The read an accepted secret discarded, whose open sequence or paste yields no key when it ends. */
  discarded: number | undefined;
}
/** Typeahead belongs to the run, not a question. */
const readOf = new WeakMap<Key, number>();
const queues = new WeakMap<AbortSignal, InputQueue>();

// Protocol final bytes are single-character names.
/* oxlint-disable eslint/id-length */
const sequences: Record<string, Key['kind']> = {
  '1;3C': 'wordRight',
  '1;3D': 'wordLeft',
  '1;5C': 'wordRight',
  '1;5D': 'wordLeft',
  '1~': 'home',
  '3~': 'delete',
  '4~': 'end',
  '7~': 'home',
  '8~': 'end',
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  F: 'end',
  H: 'home',
  c: 'wordRight',
  d: 'wordLeft',
};
/* oxlint-enable eslint/id-length */
const controlKeys: Record<string, Key['kind']> = {
  '\u0001': 'home',
  '\u0002': 'left',
  '\u0004': 'eof',
  '\u0005': 'end',
  '\u0006': 'right',
  '\b': 'backspace',
  '\t': 'tab',
  '\n': 'enter',
  '\u000b': 'killEnd',
  '\r': 'enter',
  '\u0015': 'killStart',
  '\u0017': 'killWhitespace',
  '\u007f': 'backspace',
};
/** Reads complete protocol sequences before interpreting a key, retaining partial reads. */
function feed(queue: InputQueue, text: string): void {
  queue.read += 1;
  if (queue.pending === '' && queue.paste === undefined) {
    queue.pendingRead = queue.read;
  }
  queue.pending += text;
  const enqueue = (key: Key, origin = queue.read) => {
    if (origin === queue.discarded) {
      return;
    }
    readOf.set(key, origin);
    queue.keys.push(key);
  };
  const emit = (kind: Key['kind'] | undefined, origin = queue.read) => {
    if (kind !== undefined && kind !== 'text' && kind !== 'paste') {
      enqueue({ kind }, origin);
    }
  };
  while (queue.pending !== '') {
    if (queue.paste !== undefined) {
      const end = queue.pending.indexOf('\u001b[201~');
      if (end !== -1) {
        const value = (queue.paste + queue.pending.slice(0, end)).split(/[\r\n]/u)[0] ?? '';
        enqueue(
          {
            kind: 'paste',
            // Pasted controls are discarded rather than interpreted as typed keys.
            // oxlint-disable-next-line eslint/no-control-regex
            value: value.replaceAll('\t', ' ').replace(/[\x00-\x1f\x7f-\x9f]/gu, ''),
          },
          queue.pendingRead,
        );
        queue.paste = undefined;
        queue.pending = queue.pending.slice(end + 6);
        queue.pendingRead = queue.read;
        continue;
      }
      let keep = 0;
      for (let count = 1; count < 6; count += 1) {
        if (queue.pending.endsWith('\u001b[201~'.slice(0, count))) {
          keep = count;
        }
      }
      queue.paste += queue.pending.slice(0, queue.pending.length - keep).replaceAll('\u001b', '');
      queue.pending = queue.pending.slice(queue.pending.length - keep);
      return;
    }
    if (queue.pending.startsWith('\u001b')) {
      queue.carriage = false;
      if (queue.pending === '\u001b' || queue.pending === '\u001b\u001b') {
        return;
      }
      const alt =
        queue.pending.startsWith('\u001b\u001b[') || queue.pending.startsWith('\u001b\u001bO');
      const offset = alt ? 1 : 0;
      const intro = queue.pending[offset + 1];
      if (intro === '[' || intro === 'O') {
        let index = offset + 2;
        let complete = false;
        if (intro === '[' && queue.pending[index] === '[') {
          if (queue.pending.length === index + 1) {
            return;
          }
          const next = queue.pending.charCodeAt(index + 1);
          if (next >= 64 && next <= 126) {
            index += 1;
          }
        }
        while (index < queue.pending.length) {
          const code = queue.pending.charCodeAt(index);
          if (code < 32 || code > 126) {
            break;
          }
          if (code >= 64) {
            const body = queue.pending.slice(offset + 2, index + 1);
            let kind = sequences[body];
            if (intro === 'O' && !['A', 'B', 'C', 'D', 'H', 'F', 'c', 'd'].includes(body)) {
              kind = undefined;
            }
            if (intro === '[' && (body === 'c' || body === 'd')) {
              kind = undefined;
            }
            if (alt) {
              kind = undefined;
              if (body === 'D') {
                kind = 'wordLeft';
              }
              if (body === 'C') {
                kind = 'wordRight';
              }
            }
            if (!alt && intro === '[' && body === '200~') {
              queue.paste = '';
            } else {
              emit(kind, queue.pendingRead);
            }
            index += 1;
            complete = true;
            break;
          }
          index += 1;
        }
        if (index === queue.pending.length && !complete) {
          return;
        }
        queue.pending = queue.pending.slice(index);
        if (queue.paste === undefined) {
          queue.pendingRead = queue.read;
        }
        queue.carriage = false;
        continue;
      }
      if (intro !== undefined && ']P_^'.includes(intro)) {
        let index = 2;
        let complete = false;
        while (index < queue.pending.length) {
          const code = queue.pending.charCodeAt(index);
          if (code === 7) {
            index += 1;
            complete = true;
            break;
          }
          if (code === 27) {
            if (index + 1 === queue.pending.length) {
              return;
            }
            if (queue.pending[index + 1] === '\\') {
              index += 2;
              complete = true;
            }
            break;
          }
          if (code < 32 || code === 127) {
            break;
          }
          index += 1;
        }
        if (!complete && index === queue.pending.length) {
          return;
        }
        queue.pending = queue.pending.slice(index);
        queue.pendingRead = queue.read;
        continue;
      }
      queue.pending = queue.pending.slice(1);
      if (queue.pending.startsWith('\u001b')) {
        queue.carriage = false;
        continue;
      }
      const next = queue.pending[0];
      if (next === '\u007f' || next === '\b') {
        emit('killWord', queue.pendingRead);
        queue.pending = queue.pending.slice(1);
      } else if (next !== undefined && next >= ' ' && next !== '\u007f') {
        if (next === 'b') {
          emit('wordLeft', queue.pendingRead);
        }
        if (next === 'f') {
          emit('wordRight', queue.pendingRead);
        }
        const point = queue.pending.codePointAt(0);
        queue.pending = queue.pending.slice(
          point === undefined ? 1 : String.fromCodePoint(point).length,
        );
      }
      continue;
    }
    const point = queue.pending.codePointAt(0);
    if (point === undefined) {
      return;
    }
    const character = String.fromCodePoint(point);
    queue.pending = queue.pending.slice(character.length);
    queue.pendingRead = queue.read;
    if (character === '\n' && queue.carriage) {
      queue.carriage = false;
      continue;
    }
    queue.carriage = character === '\r';
    const kind = controlKeys[character];
    if (kind !== undefined) {
      emit(kind);
    } else if (point >= 32 && (point < 127 || point > 159)) {
      enqueue({ kind: 'text', value: character });
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
 * raw mode, turns bracketed paste off, and shows the cursor, a suspend leaves raw mode and turns
 * bracketed paste off before the process stops, and the resume turns both on again. The shutdown
 * and the suspend write straight to stderr, because each runs inside its signal's handler and a
 * queued draw would land after the process ends or stops. Answers the call that removes them.
 */
function restoring<Options>(
  context: PromptContext<Options>,
  raw: (mode: boolean) => unknown,
): () => void {
  const removers = [
    context.onShutdown(() => {
      raw(false);
      context.host.stderr.write(pasteOff);
      if (context.host.terminal.stderr.isTTY) {
        context.host.stderr.write(showCursor);
      }
    }),
    context.onSuspend(() => {
      raw(false);
      context.host.stderr.write(pasteOff);
    }),
    context.onResume(() => {
      raw(true);
      void context.out.draw(pasteOn, controls);
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
  let escapeTimer: ReturnType<typeof setTimeout> | undefined = undefined;
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
      clearTimeout(escapeTimer);
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
      queue.paste = undefined;
      queue.held = undefined;
      queue.decoder = new StringDecoder('utf8');
      return;
    }
    clearTimeout(escapeTimer);
    // An ESC held past the window is the Escape key, even when a release stopped its timer.
    if (queue.held !== undefined && performance.now() - queue.held >= escapeWindow) {
      queue.pending = '';
    }
    queue.held = undefined;
    feed(queue, rest);
    settle();
    if (
      queue.paste === undefined &&
      (queue.pending === '\u001b' || queue.pending === '\u001b\u001b')
    ) {
      queue.held = performance.now();
      escapeTimer = setTimeout(() => {
        queue.pending = '';
        queue.held = undefined;
      }, escapeWindow);
      escapeTimer.unref();
    }
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
    void context.out.draw(hideCursor + pasteOn, controls);
    unregister = restoring(context, raw);
    input.on('data', data).once('end', end).once('close', end).once('error', inputError);
    input.resume();
    if (input.readableEnded || input.destroyed) {
      context.cancel();
    }
  } catch (error) {
    session.release();
    void context.out.draw(pasteOff, controls);
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
    discarded: undefined,
    held: undefined,
    keys: [],
    paste: undefined,
    pending: '',
    pendingRead: 0,
    read: 0,
  };
  queues.set(context.signal, queue);
  const session = sessions.get(context.signal) ?? holdInput(context, queue);
  session.readers += 1;
  let closed = false;
  let abandoned: { reason: unknown } | undefined = undefined;
  let mine: Session['waiting'] = undefined;
  let lastRead: number | undefined = undefined;
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
    /**
     * Ends this question's reading. Answers whether the run holds stdin no longer, so the question
     * writes the controls that turn bracketed paste off with its last line.
     */
    close(): boolean {
      if (!closed) {
        closed = true;
        session.readers -= 1;
        if (session.readers === 0) {
          session.release();
        }
      }
      return sessions.get(context.signal) !== session;
    },
    /**
     * Discards every key queued from the read that held the last key read. A sequence or paste
     * that read started keeps its place, so its trailing bytes never become text, and yields no
     * key when it ends.
     */
    discard() {
      queue.keys = queue.keys.filter((key) => readOf.get(key) !== lastRead);
      queue.discarded = lastRead;
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
        lastRead = readOf.get(key);
        return key;
      }
      return new Promise<Key>((resolve, reject) => {
        mine = {
          reject,
          resolve: (next) => {
            lastRead = readOf.get(next);
            resolve(next);
          },
        };
        session.waiting = mine;
      });
    },
  };
}
