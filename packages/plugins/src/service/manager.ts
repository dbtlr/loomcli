/*
 * The service managers' programs, run as child processes with no shell and no time limit. The run
 * signal ends a call with SIGTERM. Each call's output is captured and never printed.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

import { failures } from './messages.js';

/** What one call answered: the code it exited with and its standard output, or that it never started. */
type Answer =
  | { readonly kind: 'exited'; readonly code: number; readonly stdout: string }
  | { readonly kind: 'missing'; readonly cause: unknown };

/** One call: the program and its words, and the command whose report a failure points at. */
interface Call {
  readonly program: string;
  readonly args: readonly string[];
  readonly report: string;
}

/** Where the calls run: the application's name, their environment, and the run signal. */
interface Manager {
  readonly name: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
}

/** The code of a call that succeeded. */
const succeeded = 0;

/** The shell's status for a process a signal ended, 128 plus the signal's number. */
const signalBase = 128;

/** The code a call reports: its exit code, or the shell's status for the signal that ended it. */
function codeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) {
    return code;
  }
  return signal === null ? signalBase : signalBase + constants.signals[signal];
}

/** Runs one call until it exits, or until the run signal ends it, whose reason it then throws. */
function run(manager: Manager, call: Call): Promise<Answer> {
  const { signal } = manager;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(call.program, call.args, {
      env: { ...manager.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.resume();
    const end = () => child.kill('SIGTERM');
    signal.addEventListener('abort', end, { once: true });
    let settled = false;
    const settle = (answer: Answer) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', end);
      if (signal.aborted) {
        reject(signal.reason);
      } else {
        resolve(answer);
      }
    };
    child.on('error', (cause) => settle({ cause, kind: 'missing' }));
    child.on('close', (code, ended) =>
      settle({
        code: codeOf(code, ended),
        kind: 'exited',
        stdout: Buffer.concat(chunks).toString(),
      }),
    );
  });
}

/** The words of a call as a sentence repeats them. */
function callText(call: Call): string {
  return [call.program, ...call.args].join(' ');
}

/**
 * Runs one call and answers its code and output when it exits with one of the accepted codes. A
 * program that cannot be started, and any other code, fail with exit 1.
 */
async function expectCall(
  manager: Manager,
  call: Call,
  accepted: readonly number[] = [succeeded],
): Promise<{ readonly code: number; readonly stdout: string }> {
  const answer = await run(manager, call);
  if (answer.kind === 'missing') {
    throw failures.missing(manager.name, call.program, answer.cause);
  }
  if (!accepted.includes(answer.code)) {
    throw failures.exited(callText(call), answer.code, call.report);
  }
  return answer;
}

/** Waits `milliseconds`, or until the run signal aborts, whose reason it then throws. */
async function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  try {
    await sleep(milliseconds, undefined, { signal });
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }
    throw error;
  }
}

export type { Answer, Call, Manager };
export { callText, expectCall, pause, run, succeeded };
