/**
 * The lane of one signal source: the runs live on it, the shutdown, suspend, and resume handlers
 * registered on it, and the one shutdown an ending signal starts, under docs/core/signals.md. This
 * module never reads the process: a lane listens and re-raises on the source it was built over.
 */
import type { SignalSource } from './types.js';

/** The signals whose default effect ends a process, which start a shutdown while a lane listens. */
type EndingSignal = 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGTERM';

const endingSignals: readonly EndingSignal[] = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];

/** 128 plus each signal's number: the status a shell reports for a process the signal ended. */
const signalCodes = { SIGHUP: 129, SIGINT: 130, SIGQUIT: 131, SIGTERM: 143 } as const;

/** What a shutdown handler receives: what ended the process, and the status the shell sees. */
interface ShutdownEvent {
  /** The signal that ended the process, or `'exit'` when it ended on its own. */
  readonly cause: EndingSignal | 'exit';
  /** The status the shell sees: 128 plus the signal's number, or the exit status. */
  readonly code: number;
}

/** A handler's own return type, which a handler that returns a promise does not satisfy. */
type Synchronous<Returned> = Returned extends PromiseLike<unknown> ? never : Returned;

/** Registers a synchronous handler that runs once when the process ends, and answers its remover. */
type OnShutdown = <Returned>(
  handler: (event: ShutdownEvent) => Synchronous<Returned>,
) => () => void;

/** One shutdown handler as a lane holds it. */
interface ShutdownRegistration {
  readonly handler: (event: ShutdownEvent) => unknown;
  /** Receives what the handler threw. A handler registered without one has its throw dropped. */
  readonly failed?: ((thrown: unknown) => void) | undefined;
}

/** One suspend or resume handler as a lane holds it. */
interface HandlerRegistration {
  readonly handler: () => unknown;
}

/** What a lane reads from one live run. */
interface LaneRun {
  /** Aborts the run with the signal as its source. A run already cancelled keeps its reason. */
  readonly cancel: (event: { readonly signal: EndingSignal }) => void;
  /** Writes every region frame still queued straight to the run's terminal and shows the cursor. */
  readonly flush: () => void;
  /** Whether the run keeps its lane listening: a `run()`, or a call whose outermost run is one. */
  readonly listens: boolean;
  /** The Application's shutdown budget, in milliseconds. */
  readonly timeout: number;
}

/** One live run's place in its lane, which it registers its own handlers through and leaves by. */
interface LanePlace {
  /** Registers a handler scoped to the run, and answers the call that removes it. */
  readonly onShutdown: (registration: ShutdownRegistration) => () => void;
  /** Ends the run's place: its handlers go with it unless a shutdown is under way. */
  readonly leave: () => void;
}

/**
 * What every copy of core reads from a lane another copy may have built, which is why this shape is
 * a contract across versions of core: it only grows. No version removes a member or changes what
 * one accepts or answers, and every member takes one object argument, so a later version adds
 * fields beside the earlier ones. A later copy checks that a lane it found has a member it adds
 * before calling it, because an earlier copy may have built that lane.
 */
interface Lane {
  readonly source: SignalSource;
  enter(run: LaneRun): LanePlace;
  /** Registers a handler scoped to the process, and answers the call that removes it. */
  onShutdown(registration: ShutdownRegistration): () => void;
  onSuspend(registration: HandlerRegistration): () => void;
  onResume(registration: HandlerRegistration): () => void;
}

/** The members every version of the lane answers, which a lane another copy built is checked for. */
const laneMembers = ['enter', 'onShutdown', 'onSuspend', 'onResume'] as const;

/** Whether a value another copy of core stored is a signal source this copy can call. */
function isSignalSource(value: unknown): value is SignalSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'terminal' in value &&
    typeof Reflect.get(value, 'on') === 'function' &&
    typeof Reflect.get(value, 'off') === 'function' &&
    typeof Reflect.get(value, 'raise') === 'function'
  );
}

/** Whether a value another copy of core stored is a lane this copy can call. */
function isLane(value: unknown): value is Lane {
  return (
    typeof value === 'object' &&
    value !== null &&
    isSignalSource(Reflect.get(value, 'source')) &&
    laneMembers.every((member) => typeof Reflect.get(value, member) === 'function')
  );
}

/** The answer to a registration that holds nothing. */
function nothingHeld(): () => void {
  return () => undefined;
}

/** A place that holds nothing, which a lane without its members answers. */
const absentPlace: LanePlace = { leave: () => undefined, onShutdown: nothingHeld };

/**
 * The lane a copy of core uses over a source whose shared lane lacks the members it would call: it
 * goes without them, so it listens for nothing and holds nothing, and builds no second lane.
 */
function absentLane(source: SignalSource): Lane {
  return {
    enter: () => absentPlace,
    onResume: nothingHeld,
    onShutdown: nothingHeld,
    onSuspend: nothingHeld,
    source,
  };
}

/** One live run as its lane holds it. */
interface Place {
  readonly run: LaneRun;
  /** The run's own pending handlers. */
  readonly handlers: Set<PendingShutdown>;
  left: boolean;
  /** Whether a shutdown ended while the run was still live, after which it keeps no listener. */
  cutOff: boolean;
}

/** One pending shutdown handler, the run it belongs to, and whether it keeps the lane listening. */
interface PendingShutdown {
  readonly registration: ShutdownRegistration;
  readonly listens: boolean;
  readonly place: Place | undefined;
}

/** The shutdown under way: its first signal, and the timer or turn that ends it. */
interface Shutdown {
  signal: EndingSignal;
  budget: ReturnType<typeof setTimeout> | undefined;
  turn: ReturnType<typeof setImmediate> | undefined;
  ending: boolean;
}

/** A copy of one collection, newest entry first. */
function newestFirst<Entry>(entries: Iterable<Entry>): Entry[] {
  const reversed: Entry[] = [];
  for (const entry of entries) {
    reversed.unshift(entry);
  }
  return reversed;
}

/** A copy of one collection in its own order, so a call it makes may change the collection. */
function snapshot<Entry>(entries: Iterable<Entry>): Entry[] {
  return [...entries];
}

/** The budget one shutdown takes: none for `SIGQUIT`, else the longest timeout among the runs. */
function budgetOf(signal: EndingSignal, live: readonly Place[]): number {
  return signal === 'SIGQUIT' ? 0 : Math.max(0, ...live.map((place) => place.run.timeout));
}

/** Adds or removes one listener on a source so it is held exactly when `wanted`. */
function holdListener(
  source: SignalSource,
  held: { event: 'SIGCONT' | 'SIGTSTP'; listener: () => void; wanted: boolean },
): void {
  if (held.wanted) {
    source.on(held.event, held.listener);
  } else {
    source.off(held.event, held.listener);
  }
}

/**
 * Keeps the event loop turning until a signal raised now has reached the listeners outside core. A
 * signal a listener still hears is delivered when the loop next polls, and a process with nothing
 * else to do would otherwise end on its own first, with no listener told. Two turns hold at least
 * one poll that starts after this call.
 */
function holdForDelivery(): void {
  setImmediate(() => {
    setImmediate(() => undefined);
  });
}

/**
 * Whether a run keeps its lane listening: a run that listens, until a shutdown has cut it off.
 * Listening again for a cut-off run would catch core's own re-raise, so only a later run or
 * handler makes the lane listen again.
 */
function listensFor(place: Place): boolean {
  return place.run.listens && !place.cutOff;
}

/** Clears the timer and the turn that would have ended a shutdown, which ends now. */
function stopTimers(shutdown: Shutdown): void {
  clearTimeout(shutdown.budget);
  clearImmediate(shutdown.turn);
}

/** Calls one handler, catching whatever it throws so the rest still run. */
function callCaught(call: () => unknown, failed?: (thrown: unknown) => void): void {
  try {
    call();
  } catch (error) {
    try {
      failed?.(error);
    } catch {
      // The process is ending, so a failure to report the throw has nowhere left to go.
    }
  }
}

/**
 * The lane of one signal source. It listens for the ending signals and the `exit` event only while
 * a run that listens is live or a handler that listens is registered, and for `SIGTSTP` and
 * `SIGCONT` only while a suspend or resume handler is. An ending signal starts one shutdown: every
 * live run is cancelled, and the shutdown ends at the first of every run resolved, the budget, or
 * a second ending signal. At its end the lane flushes each live run's terminal, calls every
 * pending shutdown handler newest first, removes its listeners, and re-raises the first signal.
 */
class SignalLane implements Lane {
  readonly source: SignalSource;
  readonly #places = new Set<Place>();
  readonly #shutdownHandlers = new Set<PendingShutdown>();
  readonly #suspendHandlers = new Set<HandlerRegistration>();
  readonly #resumeHandlers = new Set<HandlerRegistration>();
  #shutdown: Shutdown | undefined = undefined;
  #listening = false;
  #listeningSuspend = false;
  #listeningResume = false;
  #suspended = false;

  readonly #onEnding: Readonly<Record<EndingSignal, () => void>> = {
    SIGHUP: () => {
      this.#received('SIGHUP');
    },
    SIGINT: () => {
      this.#received('SIGINT');
    },
    SIGQUIT: () => {
      this.#received('SIGQUIT');
    },
    SIGTERM: () => {
      this.#received('SIGTERM');
    },
  };

  readonly #onExit = (code: number): void => {
    this.#callShutdownHandlers({ cause: 'exit', code });
  };

  /**
   * Calls the suspend handlers, then re-raises SIGTSTP with core's listener gone, so its default
   * action stops the process. A raise to the process's own self returns once the process continues,
   * and at once where nothing stops it, such as an orphaned process group, which the kernel never
   * stops, or a mock, so the resume path runs as soon as the raise returns.
   */
  readonly #onSuspend = (): void => {
    for (const registration of newestFirst(this.#suspendHandlers)) {
      callCaught(registration.handler);
    }
    this.#suspended = true;
    this.#refresh();
    this.source.raise('SIGTSTP');
    this.#onResume();
  };

  readonly #onResume = (): void => {
    if (!this.#suspended) {
      return;
    }
    this.#suspended = false;
    this.#refresh();
    for (const registration of snapshot(this.#resumeHandlers)) {
      callCaught(registration.handler);
    }
  };

  constructor(source: SignalSource) {
    this.source = source;
  }

  enter(run: LaneRun): LanePlace {
    const place: Place = { cutOff: false, handlers: new Set(), left: false, run };
    this.#places.add(place);
    this.#refresh();
    const shutdown = this.#shutdown;
    // A run that starts during a shutdown starts cancelled, and does not extend the budget.
    if (shutdown !== undefined) {
      callCaught(() => {
        run.cancel({ signal: shutdown.signal });
      });
    }
    return {
      leave: () => {
        this.#leave(place);
      },
      onShutdown: (registration) => this.#register(registration, place),
    };
  }

  onShutdown(registration: ShutdownRegistration): () => void {
    return this.#register(registration, undefined);
  }

  onSuspend(registration: HandlerRegistration): () => void {
    return this.#hold(this.#suspendHandlers, registration);
  }

  onResume(registration: HandlerRegistration): () => void {
    return this.#hold(this.#resumeHandlers, registration);
  }

  #hold(held: Set<HandlerRegistration>, registration: HandlerRegistration): () => void {
    // Each registration is its own entry, so one handler registered twice is held twice.
    const entry: HandlerRegistration = { handler: registration.handler };
    held.add(entry);
    this.#refresh();
    return () => {
      held.delete(entry);
      this.#refresh();
    };
  }

  /**
   * Holds one shutdown handler, scoped to a run's place or to the process. A handler registered
   * after its run left is never called, so it holds nothing.
   */
  #register(registration: ShutdownRegistration, place: Place | undefined): () => void {
    if (place?.left === true) {
      return () => undefined;
    }
    const pending: PendingShutdown = {
      listens: place === undefined || listensFor(place),
      place,
      registration: { failed: registration.failed, handler: registration.handler },
    };
    this.#shutdownHandlers.add(pending);
    place?.handlers.add(pending);
    this.#refresh();
    return () => {
      this.#shutdownHandlers.delete(pending);
      place?.handlers.delete(pending);
      this.#refresh();
    };
  }

  #leave(place: Place): void {
    if (place.left) {
      return;
    }
    place.left = true;
    this.#places.delete(place);
    const shutdown = this.#shutdown;
    if (shutdown === undefined) {
      this.#release(place);
    } else if (this.#places.size === 0 && shutdown.turn === undefined) {
      // The last run resolved: the shutdown ends on the next turn, so code that awaited it runs.
      shutdown.turn = setImmediate(() => {
        this.#end(shutdown.signal);
      });
    }
    this.#refresh();
  }

  /** Removes a run's handlers, which go with it when it leaves while no shutdown is under way. */
  #release(place: Place): void {
    for (const pending of place.handlers) {
      this.#shutdownHandlers.delete(pending);
    }
    place.handlers.clear();
  }

  #received(signal: EndingSignal): void {
    const shutdown = this.#shutdown;
    if (shutdown === undefined) {
      this.#begin(signal);
    } else if (!shutdown.ending) {
      // A second ending signal ends the shutdown at once, and `SIGQUIT` ends it by itself.
      this.#end(signal === 'SIGQUIT' ? signal : shutdown.signal);
    }
  }

  /**
   * Begins one shutdown: the budget is fixed now, the longest timeout among the runs live now, and
   * every one of them is cancelled. A run an abort listener starts joins the lane already cancelled.
   */
  #begin(signal: EndingSignal): void {
    const live = snapshot(this.#places);
    const budget = budgetOf(signal, live);
    const shutdown: Shutdown = { budget: undefined, ending: false, signal, turn: undefined };
    this.#shutdown = shutdown;
    for (const place of live) {
      callCaught(() => {
        place.run.cancel({ signal });
      });
    }
    // An abort listener that raised a second signal on the source has ended the shutdown already.
    if (!shutdown.ending) {
      this.#bound(shutdown, budget);
    }
  }

  /** Ends the shutdown when its budget runs out, or at once for a budget of 0. */
  #bound(shutdown: Shutdown, budget: number): void {
    if (budget === 0) {
      this.#end(shutdown.signal);
      return;
    }
    shutdown.budget = setTimeout(() => {
      this.#end(shutdown.signal);
    }, budget);
  }

  /**
   * Ends the shutdown under way: every live run's queued region frames reach its terminal, every
   * pending handler is called synchronously, newest first, core's listeners go, and the signal is
   * re-raised on the source, whose default action ends the process. Nothing is awaited.
   */
  #end(signal: EndingSignal): void {
    const shutdown = this.#shutdown;
    if (shutdown === undefined || shutdown.ending) {
      return;
    }
    shutdown.ending = true;
    stopTimers(shutdown);
    this.#flushTerminals();
    this.#callShutdownHandlers({ cause: signal, code: signalCodes[signal] });
    this.#shutdown = undefined;
    this.#reraise(signal);
  }

  /**
   * Re-raises the signal on the source with core's listeners gone, whatever else listens, so its
   * default action ends the process: core never waits on another listener.
   */
  #reraise(signal: EndingSignal): void {
    this.#stopListening();
    this.source.raise(signal);
    holdForDelivery();
  }

  /** Writes every live run's queued region frames straight to its terminal and shows the cursor. */
  #flushTerminals(): void {
    for (const place of snapshot(this.#places)) {
      // A run still live at the end is cut off: it keeps core listening no more.
      place.cutOff = true;
      callCaught(place.run.flush);
    }
  }

  /** Calls every pending shutdown handler once, newest first, each removed before its call. */
  #callShutdownHandlers(event: ShutdownEvent): void {
    for (const pending of newestFirst(this.#shutdownHandlers)) {
      this.#shutdownHandlers.delete(pending);
      pending.place?.handlers.delete(pending);
      const { failed, handler } = pending.registration;
      callCaught(() => handler(event), failed);
    }
  }

  /** Whether anyone asks the lane to listen for the ending signals and the `exit` event. */
  #wantsEnding(): boolean {
    return (
      snapshot(this.#places).some(listensFor) ||
      snapshot(this.#shutdownHandlers).some((pending) => pending.listens)
    );
  }

  /** Adds listeners when the first reason appears and removes them when the last one ends. */
  #refresh(): void {
    if (this.#wantsEnding()) {
      this.#startListening();
    } else if (this.#shutdown === undefined) {
      this.#stopListening();
    }
    this.#refreshSuspend();
  }

  /** Holds the SIGTSTP and SIGCONT listeners while a suspend or resume handler is registered. */
  #refreshSuspend(): void {
    const suspending = this.#suspendHandlers.size > 0 || this.#resumeHandlers.size > 0;
    // While the process is stopped, core holds no SIGTSTP listener; it listens again on SIGCONT.
    const stopping = suspending && !this.#suspended;
    if (stopping !== this.#listeningSuspend) {
      this.#listeningSuspend = stopping;
      holdListener(this.source, { event: 'SIGTSTP', listener: this.#onSuspend, wanted: stopping });
    }
    if (suspending !== this.#listeningResume) {
      this.#listeningResume = suspending;
      holdListener(this.source, { event: 'SIGCONT', listener: this.#onResume, wanted: suspending });
    }
  }

  #startListening(): void {
    if (this.#listening) {
      return;
    }
    this.#listening = true;
    for (const signal of endingSignals) {
      this.source.on(signal, this.#onEnding[signal]);
    }
    this.source.on('exit', this.#onExit);
  }

  #stopListening(): void {
    if (!this.#listening) {
      return;
    }
    this.#listening = false;
    for (const signal of endingSignals) {
      this.source.off(signal, this.#onEnding[signal]);
    }
    this.source.off('exit', this.#onExit);
  }
}

export type {
  EndingSignal,
  HandlerRegistration,
  Lane,
  LanePlace,
  LaneRun,
  OnShutdown,
  ShutdownEvent,
  ShutdownRegistration,
  Synchronous,
};
export { absentLane, endingSignals, isLane, isSignalSource, laneMembers, signalCodes, SignalLane };
