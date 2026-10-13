import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { constants } from 'node:os';
import { basename } from 'node:path';

import { escapeControlCharacters } from '@loomcli/core';

import type { RefreshContext } from './types.js';

/** What a child answered: the code it ended with, or the error that kept it from starting. */
type Answer =
  | { readonly kind: 'exited'; readonly code: number }
  | { readonly kind: 'missing'; readonly error: unknown };

/** The shell's status for a process a signal ended, 128 plus the signal's number. */
const signalBase = 128;

/** The code of a child that succeeded. */
const succeeded = 0;

/** The words `refreshSkills` runs the replaced binary with. */
const words = ['skills', 'update'];

/** The code a child reports: its exit code, or the shell's status for the signal that ended it. */
function codeOf(code: number | null, ended: NodeJS.Signals | null): number {
  if (code !== null) {
    return code;
  }
  return ended === null ? signalBase : signalBase + constants.signals[ended];
}

/** Starts the child with the host's environment and working directory, its output piped into the host's streams. */
function start({ host, path }: RefreshContext): ChildProcess {
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

/**
 * Runs `path` with the words until it exits or cannot start. The run signal ends it with SIGTERM.
 * It never rejects.
 */
function runChild(context: RefreshContext): Promise<Answer> {
  return new Promise((resolve) => {
    const child = start(context);
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

/** The one line a child that cannot start leaves for the operator, which the child never wrote. */
function notStartedLine(path: string): string {
  return `The skills were not refreshed because ${escapeControlCharacters(path)} could not start. Run ${escapeControlCharacters(basename(path))} skills update.\n`;
}

/** The text of an error the log event carries. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * An `afterReplace` function for the self-update plugin: it runs the new binary with `skills
 * update`, because the replaced process holds the old skills, and passes the child's output
 * through. A child that fails or cannot start adds a `warn` log event and resolves, because the
 * binary update succeeded.
 */
async function refreshSkills(context: RefreshContext): Promise<void> {
  const { host, log, path } = context;
  const answer = await runChild(context);
  if (answer.kind === 'exited' && answer.code === succeeded) {
    return;
  }
  const message = 'Skills were not refreshed after the update.';
  if (answer.kind === 'exited') {
    log.warn(message, { code: answer.code, path });
    return;
  }
  host.stderr.write(notStartedLine(path));
  log.warn(message, { error: errorText(answer.error), path });
}

export { refreshSkills };
