import type { Readable, Writable } from 'node:stream';

import { backgroundQuery, queryAllowed, readReplies } from './background.js';
import type { Background } from './background.js';
import { inBackgroundJob } from './process-handle.js';
import type { Host } from './types.js';

/**
 * How long core waits for the DA1 reply, in milliseconds: a backstop for a pseudo-terminal with no
 * emulator behind it, a stalled link, or a terminal without DA1.
 */
const deadline = 1000;

/** A stream's raw-mode switch, or `undefined` when it offers none. */
function rawModeOf(stream: Readable): ((mode: boolean) => unknown) | undefined {
  if (!('setRawMode' in stream) || typeof stream.setRawMode !== 'function') {
    return undefined;
  }
  return stream.setRawMode.bind(stream);
}

/**
 * One chunk a stream emitted, as one latin1 character per byte: a Buffer's bytes, or a decoded
 * string's UTF-8 bytes. Anything else, which only an object-mode stream emits, adds nothing.
 */
function bytesOf(chunk: unknown): string {
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString('latin1');
  }
  return typeof chunk === 'string' ? Buffer.from(chunk).toString('latin1') : '';
}

/**
 * Stops a stream the wait set flowing and returns it to the flowing state found. `pause()` from the
 * flowing state emits `pause`, and only that event makes Node's and Bun's own stdin listener stop a
 * terminal's handle reading, so stdin keeps no run alive. `pause()` leaves the state `false`, where
 * a later `data` listener never starts the stream, so the state found is set back through the
 * `readableFlowing` setter that both runtimes' `Readable` defines, and a stream found flowing
 * resumes.
 */
function stopFlowing(stdin: Readable, found: boolean | null): void {
  stdin.pause();
  if (found === true) {
    stdin.resume();
  } else {
    Reflect.set(stdin, 'readableFlowing', found);
  }
}

/** A function that does nothing, which a wait's stop holds until the wait begins. */
const nothing = (): void => undefined;

/** One wait for the terminal's replies: what arrived so far, its end, and how to stop it. */
interface ReplyWait {
  readonly done: Promise<void>;
  readonly received: () => string;
  readonly stop: () => void;
}

/**
 * Calls `ask` once stdin is read, then reads it until the DA1 reply, the deadline, an abort of
 * `signal`, or the end of stdin. The deadline is one unreferenced timer, so it never keeps the
 * process alive. `stop` clears it, removes every listener the wait added, and stops stdin flowing,
 * so a terminal's handle stops reading and the stream returns to the flowing state it was found in.
 */
function waitForReplies(stdin: Readable, signal: AbortSignal, ask: () => void): ReplyWait {
  let received = '';
  let stop = nothing;
  const done = new Promise<void>((resolve) => {
    const end = () => {
      resolve();
    };
    const timer = setTimeout(end, deadline);
    timer.unref();
    const data = (chunk: unknown) => {
      received += bytesOf(chunk);
      if (readReplies(received).ended) {
        clearTimeout(timer);
        end();
      }
    };
    const found = stdin.readableFlowing;
    stop = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', end);
      stdin.off('data', data).off('end', end).off('close', end).off('error', end);
      stopFlowing(stdin, found);
    };
    signal.addEventListener('abort', end, { once: true });
    stdin.on('data', data).once('end', end).once('close', end).once('error', end);
    stdin.resume();
    // A run already cancelled never reaches the wait, so only a later abort ends it.
    ask();
  });
  return { done, received: () => received, stop: () => stop() };
}

/** Switches a stream to raw mode, answering whether it switched; a stream that throws stays as it was. */
function enterRaw(raw: (mode: boolean) => unknown): boolean {
  try {
    raw(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes the background query in raw mode and returns every byte read until the wait ends, or
 * nothing when the stream refuses raw mode. The mode found is restored in a `finally`, and stdin is
 * left in the flowing state it was found in, with no listener of core's.
 */
async function exchange(terminal: {
  readonly destination: Writable;
  readonly raw: (mode: boolean) => unknown;
  readonly signal: AbortSignal;
  readonly stdin: Readable;
}): Promise<string> {
  const { destination, raw, signal, stdin } = terminal;
  const found = Reflect.get(stdin, 'isRaw') === true;
  if (!enterRaw(raw)) {
    return '';
  }
  const wait = waitForReplies(stdin, signal, () => destination.write(backgroundQuery));
  try {
    await wait.done;
  } finally {
    wait.stop();
    raw(found);
  }
  return wait.received();
}

/**
 * The answer the replies give, after every byte that is neither a reply nor an interrupt key is
 * pushed back onto the front of stdin in arrival order, so keys typed ahead reach the action's own
 * read. Raw mode turned each interrupt key into a byte, so once the mode is restored each one's
 * signal is raised through `host.raise` in arrival order, as if the key had come a moment later.
 * When stdin is not its signal source's own terminal nothing is raised: Ctrl-C and Ctrl-\ cancel
 * the run, as the action's `cancel()` does, and Ctrl-Z is dropped.
 */
async function readBackground(
  terminal: Parameters<typeof exchange>[0] & Pick<Host, 'raise'> & { readonly cancel: () => void },
): Promise<Background | undefined> {
  const { answer, signals, typeahead } = readReplies(await exchange(terminal));
  const { stdin } = terminal;
  if (typeahead !== '' && !stdin.readableEnded) {
    stdin.unshift(Buffer.from(typeahead, 'latin1'));
  }
  for (const signal of signals) {
    if (!terminal.raise(signal) && signal !== 'SIGTSTP') {
      terminal.cancel();
    }
  }
  return answer;
}

/**
 * The terminal's answer to the background query, written to stderr, or `undefined` when a skip
 * applies: the run is already cancelled, stdin offers no raw mode, the environment forbids the
 * query, or the process is a background job of the real terminal. Settlement asks only when stdin,
 * stdout, and stderr are all terminals and color is on.
 */
async function askTerminal(
  host: Host,
  run: { readonly cancel: () => void; readonly signal: AbortSignal },
): Promise<Background | undefined> {
  const { signal } = run;
  const raw = rawModeOf(host.stdin);
  if (
    signal.aborted ||
    raw === undefined ||
    !queryAllowed(host.env) ||
    inBackgroundJob(host.stdin)
  ) {
    return undefined;
  }
  return readBackground({
    cancel: run.cancel,
    destination: host.stderr,
    raise: host.raise,
    raw,
    signal,
    stdin: host.stdin,
  });
}

export { askTerminal };
