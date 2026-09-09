import type { BuiltGraph, RoutedInvocation } from './command.js';
import { prepareDispatch, routeInvocation } from './command.js';
import { InternalError, reasonOf, toFailure } from './errors.js';
import type { LoomError } from './errors.js';
import { inspectGraph } from './inspect.js';
import type { CommandGraph, CommandNode } from './inspect.js';
import { booleanValue } from './options.js';
import type { OptionValues } from './options.js';
import { pluginSentence } from './plugin.js';
import type { BuiltPlugin, PluginOptions, PluginOptionValues } from './plugin.js';
import type { Host, Out } from './types.js';
import type { DefaultValues, OptionInput } from './validation.js';

/**
 * What the rest of one chain did: the action ran, a later middleware took over by returning without
 * calling its own `next()`, or the run was cancelled before the action ran.
 */
type ChainOutcome = 'cancelled' | 'dispatched' | 'taken-over';

/**
 * What one middleware receives. `graph` is the frozen graph `inspect()` returns, built once for the
 * run, and `command` is the routed node inside it. `options` holds this plugin's own option values
 * and never another plugin's or the application's globals.
 */
interface MiddlewareContext<Options extends PluginOptions = PluginOptions> {
  readonly options: PluginOptionValues<Options>;
  readonly graph: CommandGraph;
  readonly command: CommandNode;
  readonly host: Host;
  readonly out: Out;
  readonly signal: AbortSignal;
  readonly next: () => Promise<ChainOutcome>;
}

/**
 * The default export a loader must resolve to. A loaded module is data core never declared, so the
 * check is the one runtime fact that decides it: the export is callable. Core calls it with the
 * context it owns and ignores whatever it returns.
 */
function isMiddlewareExport(value: unknown): value is (context: MiddlewareContext) => unknown {
  return typeof value === 'function';
}

/** Whether one option name was supplied as a token, in any spelling a declaration accepts. */
function supplied(scan: OptionValues, name: string): boolean {
  return scan.strings.has(name) || scan.lists.has(name) || scan.booleans.has(name);
}

/** The value shape a plugin option takes, which is what `OptionValue` gives its declaration. */
type PluginValues = Record<string, string | string[] | boolean | undefined>;

/** A collected value, or the declared array default, as this run's own copy. */
function collectedValue(collected: readonly string[] | undefined, declared: unknown): string[] {
  if (collected) {
    return [...collected];
  }
  return Array.isArray(declared) ? [...declared] : [];
}

/**
 * One plugin's own option values for one run: what the pre-scan produced, or the declared default,
 * filled without validation. A collected value and an array default are copied, so a middleware
 * that writes to what it received changes neither the declaration nor the next run.
 */
function pluginValues(inputs: readonly OptionInput[], scan: OptionValues): PluginValues {
  const values: PluginValues = {};
  for (const { config, name } of inputs) {
    const declared: unknown = config.default;
    if (config.type === 'boolean') {
      values[name] = booleanValue(scan, name, config);
    } else if (config.multiple === true) {
      values[name] = collectedValue(scan.lists.get(name), declared);
    } else {
      // Build already proved that a string option without a schema declares a string default.
      values[name] =
        scan.strings.get(name) ?? (typeof declared === 'string' ? declared : undefined);
    }
  }
  return values;
}

/** One activated plugin in the chain, with the option values its own middleware reads. */
interface ChainEntry {
  identity: string;
  load: () => unknown;
  options: PluginValues;
}

/** Whether one plugin's declared activation matched the tokens the pre-scan consumed. */
function activates(installed: BuiltPlugin, scan: OptionValues): boolean {
  const { middleware } = installed;
  if (!middleware) {
    return false;
  }
  return (
    middleware.activate === 'always' || middleware.activate.some((name) => supplied(scan, name))
  );
}

/**
 * The chain for one invocation: each installed plugin whose activation matched, in installation
 * order. Activation is read from the pre-scan, before any plugin code loads, so a plugin whose
 * option was never supplied is not in the chain and its loader is never called.
 */
function activatedEntries(plugins: readonly BuiltPlugin[], scan: OptionValues): ChainEntry[] {
  return plugins
    .filter((installed) => activates(installed, scan))
    .map((installed) => ({
      identity: installed.identity,
      // Activation proved the middleware exists, so the empty loader is never the one core calls.
      load: installed.middleware?.load ?? (() => undefined),
      options: pluginValues(installed.inputs, scan),
    }));
}

/**
 * The routed node inside the inspected graph, which routing already proved reachable. A missing
 * segment means the two readings of one graph disagree, so the chain stops rather than hand a
 * middleware the wrong Command.
 */
function nodeAt(graph: CommandGraph, path: readonly string[]): CommandNode {
  let node = graph.root;
  for (const name of path) {
    const child = node.children.find((entry) => entry.name === name);
    if (!child) {
      throw new InternalError(
        `The routed command "${path.join(' ')}" is not in the inspected graph.`,
        undefined,
      );
    }
    node = child;
  }
  return node;
}

/** A downstream promise core awaits for its completion alone; its outcome was recorded already. */
async function quiet(pending: Promise<unknown> | undefined): Promise<void> {
  if (pending) {
    try {
      await pending;
    } catch {
      // The rejection was recorded where it crossed the `next()` boundary.
    }
  }
}

/** What one entry's `next()` has done so far, which decides whether the call is still live. */
interface EntryState {
  calls: number;
  downstream?: Promise<ChainOutcome>;
  outcome?: ChainOutcome;
  rejection?: { value: unknown };
  returned: boolean;
  settled: boolean;
}

/** Everything one invocation needs after its graph is built and its defaults are validated. */
interface Invocation {
  defaults: DefaultValues;
  facts: { description: string | undefined; version: string | undefined };
  graph: BuiltGraph;
  host: Host;
  name: string;
  out: Out;
  plugins: readonly BuiltPlugin[];
  /** A fault reported after the primary outcome, which turns a would-be 0 into 1. */
  report: (fault: LoomError) => void;
  signal: AbortSignal;
}

/** The state one chain shares: what it reached, what it raised, and how it continues. */
interface Chain {
  /** Whether one value is a fault this chain reported already, which it never reports twice. */
  announced: (value: unknown) => boolean;
  cancelled: () => boolean;
  context: (entry: ChainEntry, next: () => Promise<ChainOutcome>) => MiddlewareContext;
  invoked: () => boolean;
  record: (error: unknown) => void;
  report: (fault: LoomError) => void;
  step: (index: number) => Promise<ChainOutcome>;
}

/**
 * The outcome one entry reports to its caller. `'cancelled'` wins over `'taken-over'`, so a later
 * middleware that returned because it saw the abort reports as cancelled, the order the exit codes
 * follow. An action that already ran still reports as dispatched.
 */
function reported(chain: Chain, outcome: ChainOutcome): ChainOutcome {
  return outcome === 'taken-over' && chain.cancelled() ? 'cancelled' : outcome;
}

/** One entry's turn in the chain, and the shared state that turn writes to. */
interface EntryTurn {
  chain: Chain;
  entry: ChainEntry;
  index: number;
  state: EntryState;
}

/** A `next()` call that is no longer live: it dispatches nothing and rejects. */
function misuse(turn: EntryTurn): Promise<ChainOutcome> {
  const fault = new InternalError(
    `${pluginSentence(turn.entry.identity)} called next() ${turn.state.returned ? 'after its middleware returned' : 'twice'}.`,
    undefined,
  );
  turn.chain.report(fault);
  const rejected = Promise.reject<ChainOutcome>(fault);
  void rejected.catch(() => undefined);
  return rejected;
}

/**
 * The `next` one middleware receives. It is live until that middleware's own result settles, so a
 * second call, or a call after the middleware returned, rejects and continues nothing.
 */
function nextOf(turn: EntryTurn): () => Promise<ChainOutcome> {
  const { chain, state } = turn;
  return () => {
    if (state.returned || state.calls > 0) {
      return misuse(turn);
    }
    state.calls += 1;
    const pending = chain.step(turn.index + 1).then(
      (outcome) => {
        state.outcome = outcome;
        state.settled = true;
        return outcome;
      },
      (error: unknown) => {
        state.rejection = { value: error };
        state.settled = true;
        chain.record(error);
        throw error;
      },
    );
    state.downstream = pending;
    // Core awaits the downstream promise itself, so a middleware that never awaits `next()` still
    // Holds the chain open and never ends the run with an unobserved rejection.
    void pending.catch(() => undefined);
    return pending;
  };
}

/** The middleware's own result as a value, so the decision below reads one shape. */
async function call(
  middleware: (context: MiddlewareContext) => unknown,
  context: MiddlewareContext,
): Promise<{ value: unknown } | undefined> {
  try {
    await middleware(context);
    return undefined;
  } catch (error) {
    return { value: error };
  }
}

/**
 * What one entry reports to its caller once its own result has settled. A throw before `next()`
 * settled, or without calling it, is this invocation's failure; a throw during unwinding is an
 * internal error reported after the primary outcome, which keeps its own code.
 */
async function settle(
  turn: EntryTurn,
  thrown: { value: unknown } | undefined,
): Promise<ChainOutcome> {
  const { chain, state } = turn;
  if (thrown) {
    const propagated = state.rejection !== undefined && thrown.value === state.rejection.value;
    if (propagated || !state.settled) {
      await quiet(state.downstream);
      throw thrown.value;
    }
    /**
     * A fault core recorded where it was raised, such as a misused `next()`, reaches this point
     * again when the middleware let it escape. It keeps the one report it already has.
     */
    if (!chain.announced(thrown.value)) {
      chain.report(new InternalError(reasonOf(thrown.value), thrown.value));
    }
  }
  if (state.calls === 0) {
    return reported(chain, 'taken-over');
  }
  await quiet(state.downstream);
  // A middleware that caught the rejection reports what the chain reached; the recorded failure
  // Still decides the exit code.
  return reported(chain, state.outcome ?? (chain.invoked() ? 'dispatched' : 'taken-over'));
}

/** The module one loader answers with, whether it throws where it is called or rejects later. */
async function loadModule(entry: ChainEntry): Promise<unknown> {
  try {
    return await entry.load();
  } catch (error) {
    throw new InternalError(`Loading plugin "${entry.identity}" failed: ${reasonOf(error)}`, error);
  }
}

/** A plugin's module is loaded when the chain reaches it, never before. */
async function loadMiddleware(entry: ChainEntry) {
  const module: unknown = await loadModule(entry);
  const handler: unknown =
    module !== null && typeof module === 'object' && 'default' in module
      ? module.default
      : undefined;
  if (!isMiddlewareExport(handler)) {
    throw new InternalError(
      `Loading plugin "${entry.identity}" failed: the module exports no default middleware function.`,
      undefined,
    );
  }
  return handler;
}

/** One entry's turn: its module loads here, when the chain reaches it and never before. */
async function runEntry(entry: ChainEntry, index: number, chain: Chain): Promise<ChainOutcome> {
  const middleware = await loadMiddleware(entry);
  if (chain.cancelled()) {
    /**
     * A module import cannot be aborted, so a loader already in flight settles and core starts
     * nothing with it: the middleware it resolved to is skipped.
     */
    return 'cancelled';
  }
  const state: EntryState = { calls: 0, returned: false, settled: false };
  const turn: EntryTurn = { chain, entry, index, state };
  const thrown = await call(middleware, chain.context(entry, nextOf(turn)));
  state.returned = true;
  return settle(turn, thrown);
}

/** The whole chain, answering with the failure it raised when a middleware caught that failure. */
async function runChain(
  invocation: Invocation,
  routed: RoutedInvocation,
  entries: readonly ChainEntry[],
): Promise<LoomError | undefined> {
  const run = { invoked: false, raised: undefined as LoomError | undefined };
  const terminal = async (): Promise<ChainOutcome> => {
    const dispatch = await prepareDispatch(invocation.graph, routed, invocation);
    run.invoked = true;
    await dispatch();
    return 'dispatched';
  };
  const cancelled = () => invocation.signal.aborted;
  if (entries.length === 0) {
    if (!cancelled()) {
      await terminal();
    }
    return undefined;
  }
  // The graph a middleware reads is the one `inspect()` returns, built once for the run.
  const graph = inspectGraph(invocation.name, invocation.graph, invocation.facts);
  const command = nodeAt(graph, routed.path);
  // Every fault this chain has reported, so the same one raised again carries no second report.
  const announced = new WeakSet();
  const chain: Chain = {
    announced: (value) => typeof value === 'object' && value !== null && announced.has(value),
    cancelled,
    context: (entry, next) => ({
      command,
      graph,
      host: invocation.host,
      next,
      options: entry.options,
      out: invocation.out,
      signal: invocation.signal,
    }),
    invoked: () => run.invoked,
    record: (error) => {
      run.raised ??= toFailure(error);
    },
    report: (fault) => {
      announced.add(fault);
      invocation.report(fault);
    },
    step: (index) => {
      if (cancelled()) {
        /**
         * Core starts nothing new after cancellation: a middleware the chain has not reached and
         * an action not yet dispatched are skipped, and the entries already running unwind.
         */
        return Promise.resolve<ChainOutcome>('cancelled');
      }
      const entry = entries[index];
      return entry ? runEntry(entry, index, chain) : terminal();
    },
  };
  await chain.step(0);
  return run.raised;
}

/**
 * Runs one invocation: the global pre-scan, routing, the middleware chain, and the phases the chain
 * terminates in. A middleware that returns without calling `next()` has taken over, so the
 * remaining tokens are never parsed and nothing later in the chain runs.
 */
async function runInvocation(invocation: Invocation): Promise<void> {
  const routed = routeInvocation(invocation.graph, invocation.host.argv);
  const entries = activatedEntries(invocation.plugins, routed.scan);
  const raised = await runChain(invocation, routed, entries);
  if (raised) {
    // The chain resolved because a middleware caught the rejection. The failure it caught still
    // Decides the exit code, the rule an action's caught output rejection already follows.
    throw raised;
  }
}

export type { ChainOutcome, Invocation, MiddlewareContext };
export { runInvocation };
