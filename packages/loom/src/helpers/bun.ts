import { spawn, spawnSync } from 'node:child_process';

import type { OnShutdown } from '@loomcli/core';

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
function stopSignal(signal: AbortSignal): NodeJS.Signals {
  const reason: unknown = signal.reason;
  const source: unknown =
    typeof reason === 'object' && reason !== null ? Reflect.get(reason, 'source') : undefined;
  return source === 'SIGHUP' || source === 'SIGINT' || source === 'SIGQUIT' ? source : 'SIGTERM';
}

/**
 * What a supervised Bun reads from the run that started it: the run's signal, which stops Bun, and
 * its `onShutdown`, which the work registers the synchronous undo of what it wrote through.
 */
export interface Stoppable {
  readonly signal: AbortSignal;
  readonly onShutdown: OnShutdown;
}

/** One finished Bun process: its status and everything it wrote. */
export interface BunResult {
  readonly status: number | null;
  readonly output: string;
}

/**
 * Runs Bun from the PATH with the arguments, in the directory, and waits for it. Its stdout and
 * stderr are collected together, so a failure reports them in the order Bun wrote them as nearly as
 * two pipes allow, and the output is unbounded, as git's is. A missing Bun fails with a sentence
 * that names it.
 */
export function runBun(args: readonly string[], cwd: string): BunResult {
  const result = spawnSync('bun', args, { cwd, encoding: 'utf8', maxBuffer: Infinity });
  if (isMissing(result.error)) {
    throw new Error(missingBun);
  }
  if (result.error) {
    throw result.error;
  }
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

/**
 * Runs Bun from the PATH with the arguments, in the directory, until it ends. Once the run is
 * cancelled, Bun receives the signal loom received, or SIGTERM for any other cancellation, so a
 * stopped run never builds to its end; a shutdown that ends before Bun does kills it. With
 * `collect`, Bun's stdout and stderr are collected together in the order they arrive; with
 * `inherit`, Bun writes to this process's own streams and the output is empty. A missing Bun fails
 * with a sentence that names it.
 */
export async function superviseBun(
  args: readonly string[],
  cwd: string,
  output: 'collect' | 'inherit',
  run: Stoppable,
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
    removeKill();
    signal.removeEventListener('abort', stop);
  }
}
