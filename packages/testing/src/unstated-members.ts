/**
 * What a built context holds for a member the test did not state. A built context carries nothing
 * from core: a function that returns nothing does nothing, a member whose type has an inert answer
 * gives it, and every other member asks the test to state it.
 */
import { FatalError, Phrase } from '@loomcli/core';
import type {
  Log,
  LogFields,
  MessageArguments,
  OnResume,
  OnShutdown,
  OnSuspend,
  Out,
  Region,
} from '@loomcli/core';

import {
  unstatedMember,
  unstatedViewMeasure,
  unstatedActionInvoke,
  unstatedMiddlewareNext,
  unstatedOutText,
} from './messages.js';

/** The members a test may state beside the inputs: out and log member by member, every other member whole. */
type OptionalMembers<Context> = {
  readonly [Key in keyof Context]?: Key extends 'out' | 'log'
    ? Partial<Context[Key]>
    : Context[Key];
};

/** The builders, as each sentence opens with the one that built the context. */
type Builder =
  | 'actionContext'
  | 'environmentContext'
  | 'middlewareContext'
  | 'failureHookContext'
  | 'providerContext'
  | 'viewContext';

/** Throws the sentence for a member the function read and the test did not state. */
function unstated(builder: Builder, member: string): never {
  throw new Error(unstatedMember(builder, member));
}

/** A view measure the view calls and the test did not state, which throws its sentence. */
function unstatedMeasure(member: string): () => never {
  return () => {
    throw new Error(unstatedViewMeasure(member));
  };
}

/** Does nothing, for a function that returns nothing. */
function nothing(): void {
  // A built context's function that returns nothing does nothing.
}

/** Resolves and writes nothing. */
function resolved(): Promise<void> {
  return Promise.resolve();
}

/**
 * A semantic lane that writes nothing. A streamed message is read to its end first, so the call
 * resolves when the iterable ends and rejects when it throws, as a call the verbosity hides does.
 */
async function readsToEnd(...call: MessageArguments): Promise<void> {
  const [message] = call;
  if (typeof message === 'string' || message instanceof Phrase) {
    return;
  }
  const steps = message[Symbol.asyncIterator]();
  for (let step = await steps.next(); step.done !== true; step = await steps.next()) {
    // Each chunk is discarded.
  }
}

/** The width `out.draw` reports when it draws nothing. */
const nothingDrawn = 0;

/** A signal whose controller no code holds, so it never aborts. */
function neverAborts(): AbortSignal {
  return new AbortController().signal;
}

/** Keeps no handler and answers a remover that does nothing. */
const registersNothing: OnShutdown & OnSuspend & OnResume = () => nothing;

/** An `invoke` the test did not state, which rejects with its sentence. */
function unstatedInvoke(path: readonly string[]): Promise<never> {
  const sentence = unstatedActionInvoke(path.join(' '));
  return Promise.reject(new Error(sentence));
}

/** A `next` the test did not state, which rejects with its sentence. */
function unstatedNext(): Promise<never> {
  return Promise.reject(new Error(unstatedMiddlewareNext()));
}

/** A region that is not live: it draws, ends, and reports nothing, and never closes. */
function inertRegion(): Region {
  return {
    closedBy: undefined,
    draw: resolved,
    end: resolved,
    live: false,
    report: nothing,
    signal: neverAborts(),
  };
}

/** The builders whose context carries an `out`, and the function each builds one for. */
const outBuilders: Readonly<
  Record<'actionContext' | 'middlewareContext' | 'providerContext', string>
> = {
  actionContext: 'action',
  middlewareContext: 'middleware',
  providerContext: 'provider',
};

/**
 * An `out.text` the test did not state, which throws its sentence: the text is what the function
 * goes on to read, so the builder invents none.
 */
function unstatedText(builder: keyof typeof outBuilders): () => never {
  return () => {
    throw new Error(unstatedOutText(builder, outBuilders[builder]));
  };
}

/**
 * The builder's `out`, with each member the test stated in place of its own. The semantic lanes,
 * `render`, and `results` resolve and write nothing, a lane once it has read a streamed message to
 * its end, `draw` resolves `0`, `region()` answers an
 * inert region, `text` asks to be stated, and `fatal` throws core's `FatalError`, because its type
 * is `never`.
 */
function outWith<Result>(
  stated: Partial<Out<Result>> | undefined,
  builder: keyof typeof outBuilders,
): Out<Result> {
  return {
    draw: () => Promise.resolve(nothingDrawn),
    error: readsToEnd,
    fatal: (message) => {
      throw new FatalError(message);
    },
    info: readsToEnd,
    lendTerminal: async (work) => work(),
    print: readsToEnd,
    region: inertRegion,
    render: resolved,
    results: resolved,
    success: readsToEnd,
    text: unstatedText(builder),
    warn: readsToEnd,
    ...stated,
  };
}

/**
 * The builder's `log`, whose levels do nothing, with each level the test stated in place of its own.
 * Its `with` returns a `log` whose levels call these with the bound fields beside the call's own,
 * the call's winning a shared name, unless the test states `with` itself.
 */
function logWith(stated: Partial<Log> | undefined): Log {
  const log: Log = {
    debug: nothing,
    error: nothing,
    info: nothing,
    trace: nothing,
    warn: nothing,
    with: (bound) => boundLog(log, bound),
    ...stated,
  };
  return log;
}

/** Leaves undefined fields out so they cannot replace a bound value. */
function definedFields(fields: LogFields | undefined): LogFields {
  return Object.fromEntries(
    Object.entries(fields ?? {}).filter(([, value]) => value !== undefined),
  );
}

/** Copies plain objects and arrays all the way down, so a later change to the caller's value changes nothing. */
function snapshotOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(snapshotOf);
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotOf(item)]));
  }
  return value;
}

/** A `log` whose levels call `log`'s with a snapshot of `bound` beside each call's own fields. */
function boundLog(log: Log, bound: LogFields): Log {
  const snapshot = Object.fromEntries(
    Object.entries(definedFields(bound)).map(([key, value]) => [key, snapshotOf(value)]),
  );
  const level =
    (name: Exclude<keyof Log, 'with'>) =>
    (message: string, fields?: LogFields): void => {
      log[name](message, { ...snapshot, ...definedFields(fields) });
    };
  const bounded: Log = {
    debug: level('debug'),
    error: level('error'),
    info: level('info'),
    trace: level('trace'),
    warn: level('warn'),
    with: (more) => boundLog(bounded, more),
  };
  return bounded;
}

export {
  logWith,
  neverAborts,
  nothing,
  outWith,
  readsToEnd,
  registersNothing,
  resolved,
  unstated,
  unstatedInvoke,
  unstatedMeasure,
  unstatedNext,
};
export type { OptionalMembers };
