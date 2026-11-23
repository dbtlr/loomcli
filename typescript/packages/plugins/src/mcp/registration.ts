/*
 * The registration an application holds with an agent: its name and the command line that starts
 * its server, and the one call that runs an agent's program through the run's `host.spawn`.
 */
import type { Host } from '@loomcli/core';

/** The registration name: the application's name with each `.` written as `_`. */
function registrationName(applicationName: string): string {
  return applicationName.replaceAll('.', '_');
}

/** The words that start this application's server again: `host.program`, then `mcp`. */
function commandLine(host: Host): readonly string[] {
  return [...host.program, 'mcp'];
}

/** What one call to an agent's program answered. */
type Answer =
  | { readonly kind: 'unstarted' }
  | {
      readonly kind: 'exited';
      readonly code: number;
      readonly stdout: string;
      readonly stderr: string;
    };

/** What a call to an agent's program needs from the run: its host and its signal. */
interface Spawner {
  readonly host: Host;
  readonly signal: AbortSignal;
}

/** The answer of one spawn, `unstarted` for a program that cannot start or a handle that throws. */
async function spawned(
  { host, signal }: Spawner,
  program: string,
  args: readonly string[],
): Promise<Answer> {
  try {
    const exit = await host.spawn(program, args, { signal, stderr: 'capture', stdout: 'capture' })
      .exited;
    if (exit.kind === 'exited') {
      return {
        code: exit.code,
        kind: 'exited',
        stderr: exit.stderr.text,
        stdout: exit.stdout.text,
      };
    }
  } catch {
    // A handle whose spawn throws for a program it cannot start reads as one that does not start.
  }
  return { kind: 'unstarted' };
}

/**
 * Runs one agent call with the host's environment and working directory, no shell and no input,
 * its output captured, until it exits or the run signal ends it. A program that cannot start, and
 * a handle whose `spawn` throws for one, answer `unstarted`. A run signal that has aborted, before
 * the call or by the time it ends, throws its reason in place of an answer, so no later call starts.
 */
async function callAgent(
  { host, signal }: Spawner,
  program: string,
  args: readonly string[],
): Promise<Answer> {
  signal.throwIfAborted();
  const answer = await spawned({ host, signal }, program, args);
  signal.throwIfAborted();
  return answer;
}

export type { Answer };
export { callAgent, commandLine, registrationName };
