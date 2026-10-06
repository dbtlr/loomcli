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
 * The first cause to abort one run's private controller, which fixes the reason and the code; a
 * later cause changes neither.
 */
function firstCause(controller: AbortController): {
  cancel: (next: CancellationReason) => void;
  reason: () => CancellationReason | undefined;
} {
  let reason: CancellationReason | undefined = undefined;
  return {
    cancel: (next) => {
      if (reason) {
        return;
      }
      reason = next;
      controller.abort(next);
    },
    reason: () => reason,
  };
}

/**
 * Calls `listener` once `signal` aborts, at once when it has aborted already, and answers the call
 * that ends the subscription.
 */
function subscribe(signal: AbortSignal | undefined, listener: () => void): () => void {
  if (signal === undefined) {
    return () => undefined;
  }
  if (signal.aborted) {
    listener();
    return () => undefined;
  }
  signal.addEventListener('abort', listener);
  return () => {
    signal.removeEventListener('abort', listener);
  };
}

/**
 * The bracket for one run. Core subscribes to a caller's signal at run entry, and installs its own
 * process listeners only for the plugin that owns the signals slot, only after the graph has built,
 * and only until the run resolves. A process signal that arrives once the run is already cancelled
 * is the force path: core removes its own listeners and re-raises, so the default disposition ends
 * the process when no other listener remains. Core does not own the process.
 */
function bracketRun(controller: AbortController, caller: AbortSignal | undefined): SignalBracket {
  const first = firstCause(controller);
  let held: { handler: () => void; signal: ProcessSignal }[] = [];

  const release = () => {
    for (const entry of held) {
      process.off(entry.signal, entry.handler);
    }
    held = [];
  };

  const received = (signal: ProcessSignal) => {
    if (first.reason()) {
      release();
      process.kill(process.pid, signal);
      return;
    }
    first.cancel({ source: signal });
  };

  const unsubscribe = subscribe(caller, () => {
    first.cancel({ cause: caller?.reason, source: 'caller' });
  });

  return {
    finish: () => {
      release();
      unsubscribe();
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
    reason: first.reason,
  };
}

/**
 * The run an action belongs to, as a call it makes reads it: the run's signal, and the reason the
 * run's first cause fixed.
 */
interface ParentRun {
  signal: AbortSignal;
  reason: () => CancellationReason | undefined;
}

/**
 * The bracket for one invocation by name. Its signal derives from the parent run's, when an action
 * made the call, and from the caller's own, and the first to abort fixes the reason: a parent's
 * abort carries the parent's reason, so the call resolves the parent's code, and the caller's own
 * abort reads as a caller abort. It installs no process listener, whatever the signals owner
 * claimed, so the call touches no process.
 */
function bracketCall(
  controller: AbortController,
  causes: { caller: AbortSignal | undefined; parent: ParentRun | undefined },
): SignalBracket {
  const { caller, parent } = causes;
  const first = firstCause(controller);
  // A parent's signal aborts only after its own first cause fixed the reason it carries.
  const subscriptions = [
    subscribe(parent?.signal, () => {
      first.cancel(parent?.reason() ?? { source: 'caller' });
    }),
    subscribe(caller, () => {
      first.cancel({ cause: caller?.reason, source: 'caller' });
    }),
  ];
  return {
    finish: () => {
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
    },
    install: () => undefined,
    reason: first.reason,
  };
}

export type { CancellationCode, CancellationReason, ParentRun, ProcessSignal, SignalBracket };
export { bracketCall, bracketRun, cancellationCode, isCancellationEcho, isProcessSignal };
