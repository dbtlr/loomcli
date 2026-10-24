/*
 * The service managers' programs, run as child programs through the run's `host.spawn`, with no
 * shell and no time limit. The run signal ends a call with SIGTERM. Each call's output is captured
 * and never printed.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import type { Host } from '@loomcli/core';

import { failures } from './messages.js';

/** What one call answered: the code it exited with and its standard output, or that it never started. */
type Answer =
  | { readonly kind: 'exited'; readonly code: number; readonly stdout: string }
  | { readonly kind: 'missing'; readonly error: unknown };

/** One call: the program and its words, and the command whose report a failure points at. */
interface Call {
  readonly program: string;
  readonly args: readonly string[];
  readonly report: string;
}

/** Where the calls run: the application's name, their environment, the run signal, and the run's spawn. */
interface Manager {
  readonly name: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
  readonly spawn: Host['spawn'];
}

/** The code of a call that succeeded. */
const succeeded = 0;

/**
 * Runs one call from the run's working directory, its standard output captured and its standard
 * error discarded, until it exits, or until the run signal ends it, whose reason it then throws.
 */
async function run(manager: Manager, call: Call): Promise<Answer> {
  const { signal } = manager;
  signal.throwIfAborted();
  const exit = await manager.spawn(call.program, call.args, {
    env: manager.env,
    signal,
    stderr: 'ignore',
  }).exited;
  signal.throwIfAborted();
  return exit.kind === 'exited'
    ? { code: exit.code, kind: 'exited', stdout: exit.stdout.text }
    : { error: exit.error, kind: 'missing' };
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
    throw failures.missing(manager.name, call.program, answer.error);
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
