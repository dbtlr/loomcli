/*
 * The `afterReplace` refresh the installing plugins share: a replaced process holds the old
 * version's files, so it runs the new binary with the plugin's `update` words and passes the
 * child's output through. A child that fails or cannot start adds a `warn` log event and resolves,
 * because the binary update succeeded.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { constants } from 'node:os';
import { basename } from 'node:path';

import { escapeControlCharacters } from '@loomcli/core';
import type { Host, Log } from '@loomcli/core';

/** What a refresh reads from a self-update's `afterReplace` context. */
interface RefreshContext {
  /** The binary that replaced this one. */
  readonly path: string;
  /** The run's host. */
  readonly host: Host;
  /** The run signal. */
  readonly signal: AbortSignal;
  /** The run's log. */
  readonly log: Log;
}

/**
 * What one plugin's refresh runs and says: the words the new binary runs with, the `warn` log
 * event's message, and the line a child that cannot start leaves for the operator, from the
 * binary's path and its name, each escaped.
 */
interface Refresh {
  readonly words: readonly string[];
  readonly warning: string;
  readonly notStarted: (path: string, name: string) => string;
}

/** What a child answered: the code it ended with, or the error that kept it from starting. */
type Answer =
  | { readonly kind: 'exited'; readonly code: number }
  | { readonly kind: 'missing'; readonly error: unknown };

/** The shell's status for a process a signal ended, 128 plus the signal's number. */
const signalBase = 128;

/** The code of a child that succeeded. */
const succeeded = 0;

/** The code a child reports: its exit code, or the shell's status for the signal that ended it. */
function codeOf(code: number | null, ended: NodeJS.Signals | null): number {
  if (code !== null) {
    return code;
  }
  return ended === null ? signalBase : signalBase + constants.signals[ended];
}

/** Starts the child with the host's environment and working directory, its output piped into the host's streams. */
function start({ host, path }: RefreshContext, words: readonly string[]): ChildProcess {
  const child = spawn(path, words, {
    cwd: host.cwd,
    env: { ...host.env },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(host.stdout, { end: false });
  child.stderr.pipe(host.stderr, { end: false });
  return child;
}

/** Ends the child with SIGTERM when the signal aborts, and answers the call that stops listening. */
function endOnAbort(child: ChildProcess, signal: AbortSignal): () => void {
  const end = () => child.kill('SIGTERM');
  signal.addEventListener('abort', end, { once: true });
  if (signal.aborted) {
    end();
  }
  return () => signal.removeEventListener('abort', end);
}

/** Starts the child, or answers the error a synchronous throw of the runtime carried (ENOEXEC, ENOTDIR, and others). */
function tryStart(
  context: RefreshContext,
  words: readonly string[],
): ChildProcess | Extract<Answer, { kind: 'missing' }> {
  try {
    return start(context, words);
  } catch (error) {
    return { error, kind: 'missing' };
  }
}

/**
 * Runs `path` with the words until it exits or cannot start. The run signal ends it with SIGTERM.
 * It never rejects.
 */
function runChild(context: RefreshContext, words: readonly string[]): Promise<Answer> {
  return new Promise((resolve) => {
    const child = tryStart(context, words);
    if ('kind' in child) {
      resolve(child);
      return;
    }
    const release = endOnAbort(child, context.signal);
    let settled = false;
    const settle = (answer: Answer) => {
      if (!settled) {
        settled = true;
        release();
        resolve(answer);
      }
    };
    child.on('error', (error) => settle({ error, kind: 'missing' }));
    child.on('close', (code, ended) => settle({ code: codeOf(code, ended), kind: 'exited' }));
  });
}

/** The text of an error the log event carries. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the new binary with the refresh's words and passes its output through. A child that fails
 * adds the `warn` event with its code, and one that cannot start writes the refresh's line to the
 * host's stderr and adds the event with its error; either way it resolves.
 */
async function refreshByRunning(context: RefreshContext, refresh: Refresh): Promise<void> {
  const { host, log, path } = context;
  const answer = await runChild(context, refresh.words);
  if (answer.kind === 'exited' && answer.code === succeeded) {
    return;
  }
  if (answer.kind === 'exited') {
    log.warn(refresh.warning, { code: answer.code, path });
    return;
  }
  const name = escapeControlCharacters(basename(path));
  host.stderr.write(refresh.notStarted(escapeControlCharacters(path), name));
  log.warn(refresh.warning, { error: errorText(answer.error), path });
}

export type { RefreshContext };
export { refreshByRunning };
