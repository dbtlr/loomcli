/**
 * What a built context holds for a member the test did not state. A built context carries nothing
 * from core: a function that returns nothing does nothing, a member whose type has an inert answer
 * gives it, and every other member asks the test to state it.
 */
import { FatalError } from '@loomcli/core';
import type { Log, OnResume, OnShutdown, OnSuspend, Out, Region } from '@loomcli/core';

/** The members a test may state beside the inputs: out and log member by member, every other member whole. */
type OptionalMembers<Context> = {
  readonly [Key in keyof Context]?: Key extends 'out' | 'log'
    ? Partial<Context[Key]>
    : Context[Key];
};

/** The builders, as each sentence opens with the one that built the context. */
type Builder =
  | 'actionContext'
  | 'middlewareContext'
  | 'failureHookContext'
  | 'providerContext'
  | 'viewContext';

/** Throws the sentence for a member the function read and the test did not state. */
function unstated(builder: Builder, member: string): never {
  throw new Error(`${builder} has no ${member}. Add ${member} to its values.`);
}

/** A view measure the view calls and the test did not state, which throws its sentence. */
function unstatedMeasure(member: string): () => never {
  return () => {
    throw new Error(
      `viewContext has no ${member} for this view to call. Add ${member} to its values.`,
    );
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
  return Promise.reject(
    new Error(
      `actionContext has no invoke for "${path.join(' ')}". Add invoke to its values, such as invoke: async () => ({ status: 'completed', output: '', messages: '' }).`,
    ),
  );
}

/** A `next` the test did not state, which rejects with its sentence. */
function unstatedNext(): Promise<never> {
  return Promise.reject(
    new Error(
      "middlewareContext has no next for this middleware to call. Add next to its values, such as next: async () => 'dispatched'.",
    ),
  );
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
const outBuilders: Readonly<Record<'actionContext' | 'middlewareContext', string>> = {
  actionContext: 'action',
  middlewareContext: 'middleware',
};

/**
 * An `out.text` the test did not state, which throws its sentence: the text is what the function
 * goes on to read, so the builder invents none.
 */
function unstatedText(builder: keyof typeof outBuilders): () => never {
  return () => {
    throw new Error(
      `${builder} has no out.text for this ${outBuilders[builder]} to read. Add text to its out values, such as out: { text: () => 'page\\n' }.`,
    );
  };
}

/**
 * The builder's `out`, with each member the test stated in place of its own. The semantic lanes,
 * `render`, and `results` resolve and write nothing, `draw` resolves `0`, `region()` answers an
 * inert region, `text` asks to be stated, and `fatal` throws core's `FatalError`, because its type
 * is `never`.
 */
function outWith<Result>(
  stated: Partial<Out<Result>> | undefined,
  builder: keyof typeof outBuilders,
): Out<Result> {
  return {
    debug: resolved,
    draw: () => Promise.resolve(nothingDrawn),
    error: resolved,
    fatal: (message) => {
      throw new FatalError(message);
    },
    info: resolved,
    print: resolved,
    region: inertRegion,
    render: resolved,
    results: resolved,
    success: resolved,
    text: unstatedText(builder),
    trace: resolved,
    warn: resolved,
    ...stated,
  };
}

/** The builder's `log`, whose levels do nothing, with each level the test stated in place of its own. */
function logWith(stated: Partial<Log> | undefined): Log {
  return {
    debug: nothing,
    error: nothing,
    info: nothing,
    trace: nothing,
    warn: nothing,
    ...stated,
  };
}

export {
  logWith,
  neverAborts,
  nothing,
  outWith,
  registersNothing,
  unstated,
  unstatedInvoke,
  unstatedMeasure,
  unstatedNext,
};
export type { OptionalMembers };
