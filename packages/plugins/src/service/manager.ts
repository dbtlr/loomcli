/*
 * The service managers' programs, run as child programs through the run's `host.spawn`, with no
 * shell. A call runs until it exits, and the run signal ends it with SIGTERM; only a read that
 * status makes has a time limit. Each call's output is captured and never printed. Each call that
 * started is named at -v once it ends, and each call that changes a unit and exits with an accepted
 * code records `Program run.`, under ADR-0165.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { FatalError } from '@loomcli/core';
import type { ChildExit, Host, Log, OnShutdown } from '@loomcli/core';

import { programRun } from '../change-events.js';
import { managerExited, managerMissing, ranCall } from './messages.js';

/** What one call answered: the code it exited with and its standard output, or that it never started. */
type Answer =
  | { readonly kind: 'exited'; readonly code: number; readonly stdout: string }
  | { readonly kind: 'missing'; readonly error: unknown };

/** What one read answered: as a call does, or that the plugin's own limit ended it. */
type Read = Answer | { readonly kind: 'timedOut' };

/** One call: the program and its words, and the command whose report a failure points at. */
interface Call {
  readonly program: string;
  readonly args: readonly string[];
  readonly report: string;
}

/**
 * Where the calls run: the application's name, their environment, the run signal, the run's
 * shutdown registration, and the run's spawn, with the action's `-v` lane, which names each call,
 * and its log, which records each change.
 */
interface Manager {
  readonly name: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
  readonly onShutdown: OnShutdown;
  readonly spawn: Host['spawn'];
  readonly log: Log;
}

/** The code of a call that succeeded. */
const succeeded = 0;

/** How many seconds one read that status makes may run before the plugin ends it. */
const readLimitSeconds = 5;

const millisecondsPerSecond = 1000;

/** The read limit in milliseconds. */
const readLimit = readLimitSeconds * millisecondsPerSecond;

/** What a call that ended answered. */
function answerOf(exit: ChildExit): Answer {
  return exit.kind === 'exited'
    ? { code: exit.code, kind: 'exited', stdout: exit.stdout.text }
    : { error: exit.error, kind: 'missing' };
}

/** Logs a call that started once it ends, whatever its code; one that could not start logs none. */
function sayRan(manager: Manager, call: Call, started: boolean): void {
  if (started) {
    const ran = ranCall(call.program, call.args);
    manager.log.debug(ran.template, ran.fields);
  }
}

/**
 * Runs one call from the run's working directory, its standard output captured and its standard
 * error discarded, until it exits, or until the run signal ends it, whose reason it then throws.
 */
async function run(manager: Manager, call: Call, changes: readonly number[] = []): Promise<Answer> {
  const { signal } = manager;
  signal.throwIfAborted();
  const exit = await manager.spawn(call.program, call.args, {
    env: manager.env,
    signal,
    stderr: 'ignore',
  }).exited;
  signal.throwIfAborted();
  sayRan(manager, call, exit.kind === 'exited' && !changes.includes(exit.code));
  return answerOf(exit);
}

/**
 * Runs one read as `run` does, and ends it with SIGKILL, which a manager cannot ignore, once
 * `readLimit` passes. The limit is the plugin's own timer, read here and never inferred from the
 * exit code, because a manager that exits 143 on its own is no read that ran out. A run cancelled
 * during the read throws the signal's reason, and a shutdown that ends while it runs kills it.
 */
async function readCall(manager: Manager, call: Call): Promise<Read> {
  const { signal } = manager;
  signal.throwIfAborted();
  const child = manager.spawn(call.program, call.args, {
    env: manager.env,
    signal,
    stderr: 'ignore',
  });
  let ranOut = false;
  const timer = setTimeout(() => {
    ranOut = true;
    child.kill('SIGKILL');
  }, readLimit);
  const removeKill = manager.onShutdown(() => {
    child.kill('SIGKILL');
  });
  const exit = await child.exited.finally(() => {
    clearTimeout(timer);
    removeKill();
  });
  signal.throwIfAborted();
  sayRan(manager, call, ranOut || exit.kind === 'exited');
  return ranOut ? { kind: 'timedOut' } : answerOf(exit);
}

/** The words of a call as a sentence repeats them. */
function callText(call: Call): string {
  return [call.program, ...call.args].join(' ');
}

/**
 * Runs one call that reads and answers its code and output when it exits with one of the accepted
 * codes. A program that cannot be started, and any other code, fail with exit 1.
 */
async function expectRead(
  manager: Manager,
  call: Call,
  selection: readonly number[] | { readonly changes: readonly number[] } = [succeeded],
): Promise<{ readonly code: number; readonly stdout: string }> {
  const changing = 'changes' in selection;
  const accepted = 'changes' in selection ? selection.changes : selection;
  const answer = await run(manager, call, changing ? accepted : []);
  if (answer.kind === 'missing') {
    throw new FatalError(
      managerMissing(manager.name, call.program),
      answer.error === undefined ? undefined : { cause: answer.error },
    );
  }
  if (!accepted.includes(answer.code)) {
    throw new FatalError(managerExited(callText(call), answer.code, call.report));
  }
  return answer;
}

/**
 * Runs one call that changes a unit as `expectRead` does, and records `Program run.` with the code
 * the plugin accepted. Its words are the manager's verbs, a unit name, a domain, a label, and a
 * path, so the event carries no secret.
 */
async function expectChange(
  manager: Manager,
  call: Call,
  accepted: readonly number[] = [succeeded],
): Promise<{ readonly code: number; readonly stdout: string }> {
  const answer = await expectRead(manager, call, { changes: accepted });
  programRun(manager.log, { arguments: call.args, code: answer.code, program: call.program });
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

export type { Answer, Call, Manager, Read };
export {
  callText,
  expectChange,
  expectRead,
  pause,
  readCall,
  readLimit,
  readLimitSeconds,
  run,
  succeeded,
};
