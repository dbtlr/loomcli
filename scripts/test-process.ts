import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as after } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export function invoke(
  file: URL,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string | undefined>; input?: string } = {},
) {
  const { env, ...rest } = options;
  const result = spawnSync(
    process.env.LOOM_TEST_RUNTIME ?? 'node',
    [fileURLToPath(file), ...args],
    {
      ...rest,
      encoding: 'utf8',
      env: { ...process.env, LOOM_CAPTURE_TEST: 'present', ...env },
      timeout: 10_000,
    },
  );
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/** How the fixture ended: the status it resolved, or the signal that ended it, and its output. */
export interface Completion {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * The same fixture spawned asynchronously, so a test can wait for a line the child announced and
 * then send it a signal. `exit` resolves once the child has ended and both of its streams closed,
 * which is how a signal that ended the process rather than a status is observed.
 */
export function start(
  file: URL,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
) {
  const { cwd, env } = options;
  const child = spawn(process.env.LOOM_TEST_RUNTIME ?? 'node', [fileURLToPath(file), ...args], {
    ...(cwd === undefined ? {} : { cwd }),
    env: { ...process.env, LOOM_CAPTURE_TEST: 'present', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  /** How the exit promise settled, read by `announced` so a child that closed early fails fast. */
  let settlement:
    | { kind: 'closed'; status: number | null; signal: NodeJS.Signals | null }
    | { kind: 'errored'; error: Error }
    | undefined = undefined;
  const exit = new Promise<Completion>((resolve, reject) => {
    child.on('error', (error) => {
      settlement = { error, kind: 'errored' };
      reject(error);
    });
    child.on('close', (status, signal) => {
      settlement = { kind: 'closed', signal, status };
      resolve({ signal, status, stderr, stdout });
    });
  });
  /** Waits until the child wrote the announced line, so a signal lands where a test means it. */
  const announced = async (line: string): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!stdout.includes(`${line}\n`)) {
      if (settlement) {
        const cause =
          settlement.kind === 'closed'
            ? `status ${settlement.status}, signal ${settlement.signal}`
            : `error ${settlement.error.message}`;
        throw new Error(
          `The fixture ended (${cause}) before announcing "${line}". It wrote:\n${stdout}${stderr}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(`The fixture never announced "${line}". It wrote:\n${stdout}${stderr}`);
      }
      await after(10);
    }
  };
  return { announced, child, exit };
}
