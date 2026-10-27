/*
 * The registration an application holds with an agent: its name and the command line that starts
 * its server, and the one call that runs an agent's program through the run's `host.spawn`.
 */
import type { Host } from '@loomcli/core';

/** A control character, U+0000 to U+001F or U+007F to U+009F. */
const controlCharacter = /\p{Cc}/u;

/** Whether the text holds a control character. */
function holdsControlCharacter(text: string): boolean {
  return controlCharacter.test(text);
}

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

/**
 * Runs one agent call with the host's environment and working directory, no shell and no input,
 * its output captured, until it exits or the run signal ends it. A program that cannot start, and
 * a handle whose `spawn` throws for one, answer `unstarted`.
 */
async function callAgent(
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

export type { Answer };
export { callAgent, commandLine, holdsControlCharacter, registrationName };
