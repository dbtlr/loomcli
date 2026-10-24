import { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import type { ProcessSignal } from '@loomcli/core';

import type { RunHost } from './run-host.js';

/** The sentence a command that needs Bun fails with when none is on the PATH. */
const missingBun =
  'Bun is not on the PATH, and loom build and loom init do their work under Bun. Install Bun from https://bun.sh and run the command again.';

/** Whether a spawn failed because no executable answered to the name. */
function isMissing(error: Error | undefined) {
  return error !== undefined && 'code' in error && error.code === 'ENOENT';
}

/**
 * The signal that stops Bun once the run is cancelled: the ending signal loom received, or SIGTERM
 * for any other cancellation.
 */
function stopSignal(signal: AbortSignal): ProcessSignal {
  const reason: unknown = signal.reason;
  const source: unknown =
    typeof reason === 'object' && reason !== null ? Reflect.get(reason, 'source') : undefined;
  return source === 'SIGHUP' || source === 'SIGINT' || source === 'SIGQUIT' ? source : 'SIGTERM';
}

/** The error a Bun that could not start fails with: the sentence for a missing Bun, else its own. */
function unstartedError(error: Error) {
  return isMissing(error) ? new Error(missingBun) : error;
}

/**
 * Two streams that collect what they receive into one text, in the order it arrives, each decoding
 * its own bytes, so a character split across two chunks of one stream reads whole. A child's
 * streams are never ended, and a whole output ends on a whole character, so nothing waits in a
 * decoder once the child has exited.
 */
function collector() {
  let written = '';
  const stream = () => {
    const decoder = new StringDecoder('utf8');
    return new Writable({
      write(chunk: Buffer, _encoding, callback) {
        written += decoder.write(chunk);
        callback();
      },
    });
  };
  return { stderr: stream(), stdout: stream(), text: () => written };
}

/** One finished Bun process: its exit code and everything it wrote. */
export interface BunResult {
  readonly code: number;
  readonly output: string;
}

/**
 * Runs Bun from the PATH with the arguments, in the directory, through the run's host, and waits
 * for it. The run's signal ends Bun once the run is cancelled, and a shutdown that ends while Bun still runs kills it. Its stdout and stderr are collected,
 * stdout first, and the output is unbounded, as git's is. A missing Bun fails with a sentence that
 * names it.
 */
export async function runBun(
  run: RunHost,
  args: readonly string[],
  cwd: string,
): Promise<BunResult> {
  const child = run.host.spawn('bun', args, { cwd, signal: run.signal });
  // A shutdown that ends while Bun still runs ends it, whatever it does with the SIGTERM it received.
  const removeKill = run.onShutdown(() => {
    child.kill('SIGKILL');
  });
  const exit = await child.exited.finally(removeKill);
  if (exit.kind === 'unstarted') {
    throw unstartedError(exit.error);
  }
  return { code: exit.code, output: `${exit.stdout.text}${exit.stderr.text}` };
}

/**
 * Runs Bun from the PATH with the arguments, in the directory, through the run's host, until it
 * ends. Once the run is cancelled, Bun receives the signal loom received, or SIGTERM for any other
 * cancellation, so a stopped run never builds to its end; a shutdown that ends before Bun does
 * kills it. With `collect`, Bun's stdout and stderr are collected together in the order they
 * arrive, as nearly as two pipes allow; with `inherit`, Bun writes to the run's own streams and the
 * output is empty. A missing Bun fails with a sentence that names it.
 */
export async function superviseBun(
  args: readonly string[],
  cwd: string,
  output: 'collect' | 'inherit',
  run: RunHost,
): Promise<BunResult> {
  const collected = output === 'collect' ? collector() : undefined;
  const child = run.host.spawn('bun', args, {
    cwd,
    stderr: collected?.stderr ?? 'inherit',
    stdout: collected?.stdout ?? 'inherit',
  });
  const stop = () => {
    child.kill(stopSignal(run.signal));
  };
  const { signal } = run;
  if (signal.aborted) {
    stop();
  } else {
    signal.addEventListener('abort', stop, { once: true });
  }
  // A shutdown that ends while Bun still runs ends it, whatever it does with the signal it received.
  const removeKill = run.onShutdown(() => {
    child.kill('SIGKILL');
  });
  try {
    const exit = await child.exited;
    if (exit.kind === 'unstarted') {
      throw unstartedError(exit.error);
    }
    return { code: exit.code, output: collected?.text() ?? '' };
  } finally {
    removeKill();
    signal.removeEventListener('abort', stop);
  }
}
