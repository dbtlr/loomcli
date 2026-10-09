import { spawn, spawnSync } from 'node:child_process';

/** The sentence a command that needs Bun fails with when none is on the PATH. */
const missingBun =
  'Bun is not on the PATH, and loom build and loom check do their work under Bun. Install Bun from https://bun.sh and run the command again.';

/** Whether a spawn failed because no executable answered to the name. */
function isMissing(error: Error | undefined) {
  return error !== undefined && 'code' in error && error.code === 'ENOENT';
}

/** The signals a watcher hands on to Bun, so stopping `loom` stops the build it runs. */
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

/**
 * Runs Bun from the PATH with the arguments until it ends, writing to this process's own streams,
 * as `bun build --watch` runs. A SIGINT or a SIGTERM that reaches this process reaches Bun, and
 * once Bun has ended, this process raises the same signal on itself, so it ends as Bun did.
 */
export async function watchBun(args: readonly string[], cwd: string): Promise<number | null> {
  const child = spawn('bun', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  let received: NodeJS.Signals | undefined = undefined;
  const handlers = forwarded.map((signal) => {
    const handler = () => {
      received = signal;
      child.kill(signal);
    };
    process.on(signal, handler);
    return { handler, signal };
  });
  try {
    return await new Promise<number | null>((resolve, reject) => {
      child.on('error', (error) => {
        reject(isMissing(error) ? new Error(missingBun) : error);
      });
      child.on('close', (status) => {
        resolve(status);
      });
    });
  } finally {
    for (const { handler, signal } of handlers) {
      process.off(signal, handler);
    }
    if (received !== undefined) {
      process.kill(process.pid, received);
    }
  }
}
