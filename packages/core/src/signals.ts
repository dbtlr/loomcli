import { InternalError } from './errors.js';

/** The signals a plugin may claim, which is the closed set core installs process listeners for. */
type ProcessSignal = 'SIGINT' | 'SIGTERM';

/**
 * What aborted one run's private controller. Core owns this value, so a middleware reads `source`
 * and never infers a signal name; `cause` carries the caller's own `signal.reason` when a caller
 * aborted. The first cause to abort fixes the reason and the code, and a later cause changes
 * neither.
 */
interface CancellationReason {
  source: ProcessSignal | 'caller';
  cause?: unknown;
}

/** The status each cause resolves. A script that saw 0 after an interrupt would carry on. */
const codes = { SIGINT: 130, SIGTERM: 143, caller: 130 } as const;

/** The status one cancelled run resolves, which is the part of `ExitCode` a signal decides. */
type CancellationCode = (typeof codes)[CancellationReason['source']];

/** The closed set a claim is drawn from, as the values a runtime signal name may take. */
const claimable = new Set<string>(['SIGINT', 'SIGTERM']);

/** Whether one declared value names a signal core installs a listener for. */
function isProcessSignal(value: unknown): value is ProcessSignal {
  return typeof value === 'string' && claimable.has(value);
}

/** The status one cancelled run resolves, which the first cause to abort fixed. */
function cancellationCode(reason: CancellationReason): CancellationCode {
  return codes[reason.source];
}

/**
 * Whether one thrown value is the cancellation the run already reports: the reason core aborted
 * with, which an API that rejects with `signal.reason` throws back, or an error every runtime
 * names `AbortError`. The chain wraps an unexpected throw, so the wrapped cause reads the same.
 */
function isCancellationEcho(thrown: unknown, reason: unknown): boolean {
  if (thrown === reason) {
    return true;
  }
  if (thrown instanceof Error && thrown.name === 'AbortError') {
    return true;
  }
  return thrown instanceof InternalError && isCancellationEcho(thrown.cause, reason);
}

/**
 * The process listeners one run holds, and the caller subscription it opened at run entry. Install
 * and removal sit together so the bracket a run keeps is readable in one place.
 */
interface SignalBracket {
  /** Installs one listener per claimed signal, once the graph has built and validated. */
  install: (owned: readonly ProcessSignal[]) => void;
  /** The reason the first cause fixed, or `undefined` while nothing has aborted the run. */
  reason: () => CancellationReason | undefined;
  /** Removes every listener this run holds. Called on the run's last exit path. */
  finish: () => void;
}

/**
 * The bracket for one run. Core subscribes to a caller's signal at run entry, and installs its own
 * process listeners only for the plugin that owns the signals slot, only after the graph has built,
 * and only until the run resolves. A process signal that arrives once the run is already cancelled
 * is the force path: core removes its own listeners and re-raises, so the default disposition ends
 * the process when no other listener remains. Core does not own the process.
 */
function bracketRun(controller: AbortController, caller: AbortSignal | undefined): SignalBracket {
  let reason: CancellationReason | undefined = undefined;
  let held: { handler: () => void; signal: ProcessSignal }[] = [];

  const release = () => {
    for (const entry of held) {
      process.off(entry.signal, entry.handler);
    }
    held = [];
  };

  const cancel = (next: CancellationReason) => {
    if (reason) {
      return;
    }
    reason = next;
    controller.abort(next);
  };

  const received = (signal: ProcessSignal) => {
    if (reason) {
      release();
      process.kill(process.pid, signal);
      return;
    }
    cancel({ source: signal });
  };

  const aborted = () => {
    cancel({ cause: caller?.reason, source: 'caller' });
  };

  if (caller?.aborted === true) {
    aborted();
  } else {
    caller?.addEventListener('abort', aborted);
  }

  return {
    finish: () => {
      release();
      caller?.removeEventListener('abort', aborted);
    },
    install: (owned) => {
      for (const signal of owned) {
        const handler = () => {
          received(signal);
        };
        process.on(signal, handler);
        held.push({ handler, signal });
      }
    },
    reason: () => reason,
  };
}

export type { CancellationCode, CancellationReason, ProcessSignal, SignalBracket };
export { bracketRun, cancellationCode, isCancellationEcho, isProcessSignal };
