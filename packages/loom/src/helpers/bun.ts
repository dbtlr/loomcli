import { spawn, spawnSync } from 'node:child_process';

/** The sentence a command that needs Bun fails with when none is on the PATH. */
const missingBun =
  'Bun is not on the PATH, and loom build and loom check do their work under Bun. Install Bun from https://bun.sh and run the command again.';

/** Whether a spawn failed because no executable answered to the name. */
function isMissing(error: Error | undefined) {
  return error !== undefined && 'code' in error && error.code === 'ENOENT';
}

/** The signals loom hands on to a Bun build it runs, so stopping `loom` stops the build. */
const forwarded = ['SIGINT', 'SIGTERM'] as const;

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

/** One Bun process loom ran to its end, and the signal loom handed on to it, if one arrived. */
export interface SupervisedBun extends BunResult {
  readonly interrupted: NodeJS.Signals | undefined;
}

/**
 * Runs Bun from the PATH with the arguments, in the directory, until it ends. A SIGINT or a SIGTERM
 * that reaches this process while Bun runs reaches Bun, and the result names it, so the caller can
 * clean up and then end as Bun did with `endAs`. With `collect`, Bun's stdout and stderr are
 * collected together in the order they arrive; with `inherit`, Bun writes to this process's own
 * streams and the output is empty. A missing Bun fails with a sentence that names it.
 */
export async function superviseBun(
  args: readonly string[],
  cwd: string,
  output: 'collect' | 'inherit',
): Promise<SupervisedBun> {
  const streams = output === 'collect' ? 'pipe' : 'inherit';
  const child = spawn('bun', args, { cwd, stdio: ['ignore', streams, streams] });
  let written = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      written += chunk;
    });
  }
  let interrupted: NodeJS.Signals | undefined = undefined;
  const handlers = forwarded.map((signal) => {
    const handler = () => {
      interrupted = signal;
      child.kill(signal);
    };
    process.on(signal, handler);
    return { handler, signal };
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
    return { interrupted, output: written, status };
  } finally {
    for (const { handler, signal } of handlers) {
      process.off(signal, handler);
    }
  }
}

/**
 * Ends this process with the signal it handed on to Bun, once nothing listens for it, so the
 * process ends as the signal's default disposition ends it and its shell reads 130 or 143.
 */
export function endAs(signal: NodeJS.Signals) {
  process.kill(process.pid, signal);
}

/**
 * Runs Bun from the PATH with the arguments until it ends, writing to this process's own streams,
 * as `bun build --watch` runs. A SIGINT or a SIGTERM that reaches this process reaches Bun, and
 * once Bun has ended, this process raises the same signal on itself, so it ends as Bun did.
 */
export async function watchBun(args: readonly string[], cwd: string): Promise<number | null> {
  const { interrupted, status } = await superviseBun(args, cwd, 'inherit');
  if (interrupted !== undefined) {
    endAs(interrupted);
  }
  return status;
}
