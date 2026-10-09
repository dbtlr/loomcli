import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/** The sentence a command that needs Bun fails with when none is on the PATH. */
const missingBun =
  'Bun is not on the PATH, and loom build and loom check do their work under Bun. Install Bun from https://bun.sh and run the command again.';

/** Whether a spawn failed because no executable answered to the name. */
function isMissing(error: Error | undefined) {
  return error !== undefined && 'code' in error && error.code === 'ENOENT';
}

/** The signals loom hands on to a Bun build it runs, so stopping `loom` stops the build. */
const forwarded = ['SIGINT', 'SIGTERM'] as const;

/**
 * Ends this process with a signal it held, once nothing listens for it, so the process ends as the
 * signal's default disposition ends it and its shell reads 130 or 143.
 */
function endAs(signal: NodeJS.Signals) {
  process.kill(process.pid, signal);
}

/** Waits for the event loop to turn once, past the phase that runs `setImmediate` callbacks. */
function nextTurn() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Waits until every signal that reached this process so far has reached its listener. A signal
 * that lands while work runs without yielding, such as the moves that place a build's files, waits
 * for the event loop to poll, and a listener released before that poll never hears it. Two turns
 * hold at least one poll that starts after this call.
 */
async function signalsDelivered() {
  await nextTurn();
  await nextTurn();
}

/** One finished Bun process: its status and everything it wrote. */
export interface BunResult {
  readonly status: number | null;
  readonly output: string;
}

/**
 * Runs Bun from the PATH with the arguments, in the directory, and waits for it. Its stdout and
 * stderr are collected together, so a failure reports them in the order Bun wrote them as nearly as
 * two pipes allow. A missing Bun fails with a sentence that names it.
 */
export function runBun(args: readonly string[], cwd: string): BunResult {
  const result = spawnSync('bun', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (isMissing(result.error)) {
    throw new Error(missingBun);
  }
  if (result.error) {
    throw result.error;
  }
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

/**
 * The SIGINT and SIGTERM this process holds while it does work it must finish or undo before it
 * ends. Holding a signal keeps it from ending the process at once; the signal reaches the Bun
 * process loom runs, if one runs, and the work reads it to know it was stopped.
 */
export class HeldSignals {
  #bun: ChildProcess | undefined = undefined;
  #received: NodeJS.Signals | undefined = undefined;
  readonly #listeners = forwarded.map((signal) => {
    const listener = () => {
      this.#received ??= signal;
      this.#bun?.kill(signal);
    };
    process.on(signal, listener);
    return { listener, signal };
  });

  /** The first signal that arrived while the signals were held, if one did. */
  get received(): NodeJS.Signals | undefined {
    return this.#received;
  }

  /**
   * Hands each held signal on to Bun until the returned function is called. A signal that arrived
   * before Bun started reaches it at once, so a stopped run never builds to its end.
   */
  forwardTo(bun: ChildProcess): () => void {
    this.#bun = bun;
    if (this.#received !== undefined) {
      bun.kill(this.#received);
    }
    return () => {
      this.#bun = undefined;
    };
  }

  /** Stops holding the signals, so the next one ends the process as its default disposition does. */
  release() {
    for (const { listener, signal } of this.#listeners) {
      process.off(signal, listener);
    }
  }
}

/**
 * Holds SIGINT and SIGTERM for the whole of the work, then releases them and, if one arrived, ends
 * this process with it, as `endAs` does, once the work has finished or undone what it wrote.
 */
export async function holdingSignals<Outcome>(
  work: (signals: HeldSignals) => Promise<Outcome>,
): Promise<Outcome> {
  const signals = new HeldSignals();
  try {
    return await work(signals);
  } finally {
    await signalsDelivered();
    signals.release();
    if (signals.received !== undefined) {
      endAs(signals.received);
    }
  }
}

/**
 * Runs Bun from the PATH with the arguments, in the directory, until it ends, handing on to it each
 * signal the caller holds. With `collect`, Bun's stdout and stderr are collected together in the
 * order they arrive; with `inherit`, Bun writes to this process's own streams and the output is
 * empty. A missing Bun fails with a sentence that names it.
 */
export async function superviseBun(
  args: readonly string[],
  cwd: string,
  output: 'collect' | 'inherit',
  signals: HeldSignals,
): Promise<BunResult> {
  const streams = output === 'collect' ? 'pipe' : 'inherit';
  const child = spawn('bun', args, { cwd, stdio: ['ignore', streams, streams] });
  let written = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      written += chunk;
    });
  }
  const stopForwarding = signals.forwardTo(child);
  try {
    const status = await new Promise<number | null>((resolve, reject) => {
      child.on('error', (error) => {
        reject(isMissing(error) ? new Error(missingBun) : error);
      });
      child.on('close', (code) => {
        resolve(code);
      });
    });
    return { output: written, status };
  } finally {
    stopForwarding();
  }
}
