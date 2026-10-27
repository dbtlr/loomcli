/**
 * Help paging: whether a page goes to the operator's pager, and the pager run that shows it. The
 * pager is the operator's `PAGER` command line, run through `/bin/sh -c` behind `exec`, so the shell
 * replaces itself with the pager's program and ending the child ends the pager under dash too.
 */
import type { Host, MiddlewareContext } from '@loomcli/core';

import { underCI } from '../ci.js';

/** The pager when `PAGER` is unset. */
const defaultPager = 'less';

/** `LESS` when the environment holds none: pass color, quit on a page that fits, keep the page. */
const defaultLess = 'FRX';

/** The shell's status for a command it found but could not run. */
const notRunnable = 126;

/** The shell's status for a command it could not find. */
const notFound = 127;

/** The shell's statuses that mean the pager never ran. */
const couldNotStart = new Set([notRunnable, notFound]);

/**
 * The pager's command line when this run may page: stdout a terminal, a `TERM` that draws, not CI,
 * and a `PAGER` that does not turn paging off. An empty or blank `PAGER`, or `cat`, is the
 * operator's standard off switch.
 */
export function pagerOf(host: Host): string | undefined {
  const { env, terminal } = host;
  const term = env.TERM ?? '';
  if (!terminal.stdout.isTTY || term === '' || term === 'dumb' || underCI(env)) {
    return undefined;
  }
  const pager = env.PAGER ?? defaultPager;
  const command = pager.trim();
  return command === '' || command === 'cat' ? undefined : pager;
}

/** Whether a page holds at least as many lines as the terminal has rows, which must be known. */
export function outgrowsScreen(host: Host, page: string): boolean {
  const { rows } = host.terminal.stdout;
  return rows !== undefined && [...page.matchAll(/\n/gu)].length >= rows;
}

/**
 * Shows the page in the pager and resolves whether help is done with it: true once the pager ran or
 * the run was cancelled, and false when the pager could not start, so the caller prints the page
 * itself. The run's signal ends the pager, and so does a shutdown that cuts the run off; both send
 * `SIGTERM`, on which less restores the terminal.
 */
export async function showInPager(
  { host, onShutdown, signal }: Pick<MiddlewareContext, 'host' | 'onShutdown' | 'signal'>,
  pager: string,
  page: string,
): Promise<boolean> {
  const env = host.env.LESS === undefined ? { ...host.env, LESS: defaultLess } : host.env;
  const child = host.spawn('/bin/sh', ['-c', `exec ${pager}`], {
    env,
    input: page,
    signal,
    stderr: 'inherit',
    stdout: 'inherit',
  });
  const remove = onShutdown(() => {
    child.kill();
  });
  try {
    const exit = await child.exited;
    return signal.aborted || (exit.kind === 'exited' && !couldNotStart.has(exit.code));
  } finally {
    remove();
  }
}
