/**
 * The Application's shutdown budget, and the handlers scoped to the process that a library or an
 * embedding host registers, which live in the real process's lane, under docs/core/signals.md.
 */
import { registerRule } from './diagnostic-text.js';
import { quoted } from './errors.js';
import { factFault, slotSite } from './facts.js';
import { processLane } from './process-handle.js';
import type { OnShutdown, Synchronous } from './signal-lane.js';

const invalidShutdownTimeout = registerRule('@loomcli/core/invalid-shutdown-timeout', {
  explanation:
    'After an ending signal, core gives the runs shutdown.timeout milliseconds to unwind and then ends the process. A timer waits a whole number of milliseconds from 0 through 2147483647, so the budget is one of those.',
  headline: 'Invalid shutdown timeout',
});

/** The budget an Application that sets none gets, in milliseconds. */
const defaultTimeout = 500;

/** The longest a timer waits, in milliseconds: the largest signed 32-bit integer. */
const longestTimeout = 2_147_483_647;

/**
 * The shutdown budget one Application declares: its `shutdown.timeout`, or 500 when it sets none.
 * Any value other than a whole number from 0 through 2147483647 is a declaration error.
 */
function shutdownTimeout(application: string, shutdown: { readonly timeout?: number } | undefined) {
  const timeout = shutdown?.timeout;
  if (timeout === undefined) {
    return defaultTimeout;
  }
  if (Number.isInteger(timeout) && timeout >= 0 && timeout <= longestTimeout) {
    return timeout;
  }
  const site = slotSite(
    { call: 'new Application', named: application, subject: 'The Application' },
    'shutdown',
    shutdown,
  );
  throw factFault(invalidShutdownTimeout, site, {
    correction: `Set shutdown.timeout to a whole number of milliseconds from 0 through ${String(longestTimeout)}, or leave it out for ${String(defaultTimeout)}.`,
    fact: 'timeout',
    sentence: `The Application declares shutdown timeout ${quoted(timeout)}, which is not a whole number of milliseconds from 0 through ${String(longestTimeout)}.`,
  });
}

/**
 * Registers a synchronous handler scoped to the process, which runs once, at the end of a shutdown
 * or at the process's own end, and answers the call that removes it. A throw is dropped.
 */
const onShutdown: OnShutdown = (handler) => processLane().onShutdown({ handler });

/** Registers a synchronous handler that runs when Ctrl-Z suspends the process, newest first. */
function onSuspend<Returned>(handler: () => Synchronous<Returned>): () => void {
  return processLane().onSuspend({ handler });
}

/** Registers a synchronous handler that runs when the process resumes, in registration order. */
function onResume<Returned>(handler: () => Synchronous<Returned>): () => void {
  return processLane().onResume({ handler });
}

export { onResume, onShutdown, onSuspend, shutdownTimeout };
