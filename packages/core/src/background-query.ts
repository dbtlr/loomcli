import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Readable, Writable } from 'node:stream';
import { ReadStream } from 'node:tty';

import { backgroundQuery, queryAllowed, readReplies } from './background.js';
import type { Background } from './background.js';
import { capabilities } from './rendering.js';
import type { RenderingPolicy } from './rendering.js';
import type { Host } from './types.js';

/**
 * How long core waits for the DA1 reply, in milliseconds: a backstop for a pseudo-terminal with no
 * emulator behind it, a stalled link, or a terminal without DA1.
 */
const deadline = 1000;

/** The process and terminal process groups a job-control check compares. */
interface JobIds {
  readonly group: number;
  readonly foreground: number;
}

/** A stream's raw-mode switch, or `undefined` when it offers none. */
function rawModeOf(stream: Readable): ((mode: boolean) => unknown) | undefined {
  if (!('setRawMode' in stream) || typeof stream.setRawMode !== 'function') {
    return undefined;
  }
  return stream.setRawMode.bind(stream);
}

/** Two process group ids, when both are positive integers. */
function jobIds(group: unknown, foreground: unknown): JobIds | undefined {
  const ids = { foreground: Number(foreground), group: Number(group) };
  return Number.isSafeInteger(ids.group) && ids.group > 0 && Number.isSafeInteger(ids.foreground)
    ? ids
    : undefined;
}

/** Where `/proc/self/stat` holds the process group and the terminal's foreground group. */
const groupField = 2;
const foregroundField = 5;

/**
 * The ids `/proc/self/stat` holds on Linux: after the command name, the fields run state, parent,
 * process group, session, terminal, and the terminal's foreground process group.
 */
function procIds(): JobIds | undefined {
  try {
    const stat = readFileSync('/proc/self/stat', 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return jobIds(fields[groupField], fields[foregroundField]);
  } catch {
    return undefined;
  }
}

/** The ids `ps` reports where there is no `/proc`, such as macOS and the BSDs. */
function psIds(): JobIds | undefined {
  try {
    const reported = execFileSync('ps', ['-o', 'tpgid=,pgid=', '-p', String(process.pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [foreground, group] = reported.trim().split(/\s+/u);
    return jobIds(group, foreground);
  } catch {
    return undefined;
  }
}

/**
 * Whether this process belongs to its terminal's foreground job. A background job that switches
 * the terminal to raw mode or reads it is stopped by SIGTTOU or SIGTTIN, so core queries only from
 * the foreground, and a check that cannot tell counts as background.
 */
function foregroundJob(): boolean {
  const ids = procIds() ?? psIds();
  return ids !== undefined && ids.group === ids.foreground;
}

/**
 * The stream the query is written to: stderr when it is a terminal whose color is on, else stdout
 * when it is, else none.
 */
function queryDestination(host: Host, policy: RenderingPolicy): Writable | undefined {
  for (const name of ['stderr', 'stdout'] as const) {
    if (host.terminal[name].isTTY && capabilities(host, name, policy).color) {
      return host[name];
    }
  }
  return undefined;
}

/**
 * One chunk a stream's `read()` returned, as one latin1 character per byte: a Buffer's bytes, or a
 * decoded string's UTF-8 bytes. Anything else, which only an object-mode stream returns, adds nothing.
 */
function bytesOf(chunk: unknown): string {
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString('latin1');
  }
  return typeof chunk === 'string' ? Buffer.from(chunk).toString('latin1') : '';
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
 * `signal`, or the end of stdin. It reads through a `readable` listener rather than a `data`
 * listener, because `resume()` and `pause()` would leave the stream's flowing state `false`, and a
 * stream in that state never starts flowing for a later `data` listener of the action's. The
 * deadline is one unreferenced timer, so it never keeps the process alive. `stop` clears it,
 * pauses stdin, which stops a terminal's handle reading, and removes every listener the wait added,
 * so the stream returns to the flowing state it was found in.
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
    const readable = () => {
      for (let chunk: unknown = stdin.read(); chunk !== null; chunk = stdin.read()) {
        received += bytesOf(chunk);
      }
      if (readReplies(received).ended) {
        clearTimeout(timer);
        end();
      }
    };
    stop = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', end);
      stdin.pause();
      stdin.off('readable', readable).off('end', end).off('close', end).off('error', end);
    };
    signal.addEventListener('abort', end, { once: true });
    stdin.on('readable', readable).once('end', end).once('close', end).once('error', end);
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
 * The answer the replies give, after every byte that is not a reply is pushed back onto the front
 * of stdin in arrival order, so keys typed ahead reach the action's own read.
 */
async function readBackground(
  terminal: Parameters<typeof exchange>[0],
): Promise<Background | undefined> {
  const { answer, typeahead } = readReplies(await exchange(terminal));
  const { stdin } = terminal;
  if (typeahead !== '' && !stdin.readableEnded) {
    stdin.unshift(Buffer.from(typeahead, 'latin1'));
  }
  return answer;
}

/**
 * The terminal's answer to the background query, or `undefined` when a skip applies: the run is
 * already cancelled, stdin is not a terminal or offers no raw mode, no destination is a terminal
 * whose color is on, the environment forbids the query, or the process is a background job of a
 * real terminal.
 */
async function askTerminal(
  host: Host,
  policy: RenderingPolicy,
  signal: AbortSignal,
): Promise<Background | undefined> {
  const raw = rawModeOf(host.stdin);
  const destination = queryDestination(host, policy);
  if (
    signal.aborted ||
    !host.terminal.stdin.isTTY ||
    raw === undefined ||
    destination === undefined ||
    !queryAllowed(host.env, host.platform) ||
    (host.stdin instanceof ReadStream && !foregroundJob())
  ) {
    return undefined;
  }
  return readBackground({ destination, raw, signal, stdin: host.stdin });
}

export { askTerminal };
