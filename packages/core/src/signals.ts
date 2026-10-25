import { InternalError } from './errors.js';
import { signalCodes } from './signal-lane.js';
import type { EndingSignal, LaneHandlers, LanePlace, LaneRun, SharedLane } from './signal-lane.js';

/**
 * What aborted one run's private controller. Core owns this value, so a middleware reads `source`
 * and never infers a signal name; `cause` carries the caller's own `signal.reason` when a caller
 * aborted, and the failed write when the reader of the run's stdout closed the pipe. The first
 * cause to abort fixes the reason and the code, and a later cause changes neither.
 */
interface CancellationReason {
  readonly source: EndingSignal | 'caller' | 'action' | 'closed-pipe';
  readonly cause?: unknown;
}

/**
 * The status each cause resolves. A script that saw 0 after an interrupt would carry on. A signal
 * resolves the status a shell reports for a process it ended, and a closed pipe 141, the status a
 * process ended by `SIGPIPE` reports, as `git` and `yes` do.
 */
const codes = { ...signalCodes, action: 130, caller: 130, 'closed-pipe': 141 } as const;

/** The status one cancelled run resolves, which is the part of `ExitCode` a signal decides. */
type CancellationCode = (typeof codes)[CancellationReason['source']];

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
 * Whether a throw in a cancelled run echoes its cancellation, so no translator is offered it and no
 * report renders it. A value that cannot be read, such as an Error whose `name` getter throws,
 * counts as an echo, so it keeps its cancellation code and no translator replaces it.
 */
function echoesCancellation(thrown: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted) {
    return false;
  }
  try {
    return isCancellationEcho(thrown, signal.reason);
  } catch {
    return true;
  }
}

/**
 * What cancels one run, and its place in its signal source's lane: the caller subscription it
 * opened at run entry and the place it holds until it resolves. Entry and removal sit together so
 * the bracket a run keeps is readable in one place.
 */
interface SignalBracket {
  cancel: () => void;
  /** Aborts the run because the reader of its stdout closed the pipe, which `cause` failed on. */
  closePipe: (cause: unknown) => void;
  /** The run's place in its lane, which its `onShutdown` handlers are registered through. */
  place: LanePlace;
  /** The reason the first cause fixed, or `undefined` while nothing has aborted the run. */
  reason: () => CancellationReason | undefined;
  /** Leaves the lane and ends the caller subscription. Called on the run's last exit path. */
  finish: () => void;
}

/** What one run's place in its lane reads beside its cancellation. */
type LaneEntry = Omit<LaneRun, 'cancel'>;

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
 * The run an action belongs to, as a call it makes reads it: the run's signal, and the reason the
 * run's first cause fixed.
 */
interface ParentRun {
  signal: AbortSignal;
  reason: () => CancellationReason | undefined;
}

/**
 * The bracket for one run. Core subscribes to a caller's signal at run entry and, for an action's
 * call, to its parent run's, and the first to abort fixes the reason: a parent's abort carries the
 * parent's reason, so the call resolves the parent's code, and the caller's own abort reads as a
 * caller abort. The run takes its place in the lane of its process handle's signal source, which
 * cancels it with the signal as its source when a shutdown begins and calls its handlers. A
 * `run()`, and a call whose outermost run is one, keep the lane listening from this moment;
 * `app.invoke` makes no process effect, so it never does.
 */
function bracketRun(
  controller: AbortController,
  causes: {
    caller: AbortSignal | undefined;
    parent?: ParentRun | undefined;
    lane: SharedLane;
    entry: LaneEntry;
  },
): SignalBracket {
  const { caller, entry, lane, parent } = causes;
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
  // A run that enters during a shutdown starts cancelled, unless an earlier cause already did.
  const place = lane.enter({
    ...entry,
    cancel: ({ signal }) => {
      first.cancel({ source: signal });
    },
  });
  return {
    cancel: () => first.cancel({ source: 'action' }),
    closePipe: (cause) => first.cancel({ cause, source: 'closed-pipe' }),
    finish: () => {
      place.leave();
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
    },
    place,
    reason: first.reason,
  };
}

/** The handlers one context registers through its run's place, each throw going to its `failed`. */
function placeHandlers(
  place: LanePlace,
  failed: Readonly<Record<'resume' | 'shutdown' | 'suspend', (thrown: unknown) => void>>,
): LaneHandlers {
  return {
    onResume: (handler) => place.onResume({ failed: failed.resume, handler }),
    onShutdown: (handler) => place.onShutdown({ failed: failed.shutdown, handler }),
    onSuspend: (handler) => place.onSuspend({ failed: failed.suspend, handler }),
  };
}

export type { CancellationCode, CancellationReason, LaneEntry, ParentRun, SignalBracket };
export { bracketRun, cancellationCode, echoesCancellation, isCancellationEcho, placeHandlers };
