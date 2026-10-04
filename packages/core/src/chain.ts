import type { BuiltGraph, Prepared } from './command.js';
import { prepareDispatch } from './command.js';
import { foreignFailure, InternalError, routedSubject } from './errors.js';
import type { LoomError } from './errors.js';
import { nodeAt } from './inspect.js';
import type { CommandGraph, CommandNode } from './inspect.js';
import { isSupplied } from './options.js';
import type { OptionValues } from './options.js';
import { parseInvocation } from './parse.js';
import type { ParsedInvocation } from './parse.js';
import { loadDefault, pluginSentence, pluginSpellings } from './plugin.js';
import type {
  BuiltPlugin,
  PluginOptions,
  PluginOptionSpellings,
  PluginOptionValues,
} from './plugin.js';
import { nextMisuse, viewSelection, viewSelectionCorrection } from './rules.js';
import type { ContextualStyle } from './style.js';
import type {
  ActionChannel,
  DeclaredResult,
  Host,
  OpenResult,
  Out,
  Request,
  ResultBinding,
} from './types.js';
import type { InputPlaces, DeclaredValues } from './validation.js';

/**
 * What the rest of one chain did: the action ran, a later middleware took over by returning without
 * calling its own `next()`, or the run was cancelled before the action ran.
 */
type ChainOutcome = 'cancelled' | 'dispatched' | 'taken-over';

/**
 * What one middleware receives. `graph` is the frozen graph `inspect()` returns, built once for the
 * run, and `command` is the routed node inside it. `options` holds the validated value of every
 * global option, the application's and every plugin's, keyed by declared name: the plugin's own
 * options are typed from its declaration and every other key reads `unknown`, because a plugin
 * compiles without the Application that installs it. It is `null` when a global option has a
 * structural fault or was rejected, so a middleware never reads a global value no validator
 * accepted, and a fault on a local option alone leaves it set. `spellings` holds the spelling that
 * supplied each of the plugin's own options as a token, which a filled or defaulted option never
 * has. `request` is the routed Command's invocation, parsed and validated ahead of the chain, and
 * `null` while core holds a fault and on a group. `view` names the view the result renders
 * through: it reads as the declaration's default until a middleware assigns one, and as `null` on
 * a Command that declares none. The last assignment before the dispatch boundary wins, and one
 * made after it changes nothing.
 */
interface MiddlewareContext<Options extends PluginOptions = PluginOptions> {
  readonly options: (PluginOptionValues<Options> & Readonly<Record<string, unknown>>) | null;
  readonly spellings: PluginOptionSpellings<Options>;
  readonly graph: CommandGraph;
  readonly command: CommandNode;
  readonly request: Request | null;
  get view(): string | null;
  set view(name: string);
  readonly host: Host;
  readonly out: Out;
  readonly signal: AbortSignal;
  readonly next: () => Promise<ChainOutcome>;
}

/** One middleware's assignment of the view a result renders through, and the plugin that made it. */
interface ViewAssignment {
  identity: string;
  name: unknown;
}

/**
 * The view one run selects, which is one value whichever middleware wrote it. The assignment is
 * kept as it arrived, because a JavaScript caller reaches the setter with any value and the check
 * belongs at the dispatch boundary, where the fault it raises ranks behind a held fault.
 */
class ViewSelection {
  #assigned: ViewAssignment | undefined = undefined;
  #reached = false;
  readonly #result: DeclaredResult | undefined;

  constructor(result: DeclaredResult | undefined) {
    this.#result = result;
  }

  /**
   * What `view` reads: the assigned name, or the declaration's default until one is assigned, and
   * `null` on a Command that declares no result, whatever was assigned there. An assignment that is
   * not a name reads as the default, because the getter answers a view name and the assignment is
   * the boundary's fault. The assignment itself is kept either way, so the boundary still raises it.
   */
  read(): string | null {
    if (!this.#result) {
      return null;
    }
    const assigned = this.#assigned;
    if (assigned !== undefined && typeof assigned.name === 'string') {
      return assigned.name;
    }
    return this.#result.default;
  }

  /** The last assignment before the boundary wins; one made after it changes nothing. */
  assign(identity: string, name: unknown): void {
    if (!this.#reached) {
      this.#assigned = { identity, name };
    }
  }

  /** The chain reached the dispatch boundary, so this run's view is fixed whatever follows. */
  reach(): void {
    this.#reached = true;
  }

  /**
   * The name the boundary dispatches through: `null` when no middleware assigned one and the
   * declaration's default stands. A plugin that selected a view has the name checked here.
   */
  resolve(path: readonly string[]): string | null {
    const assigned = this.#assigned;
    if (assigned === undefined) {
      return null;
    }
    const plugin = pluginSentence(assigned.identity);
    const { name } = assigned;
    if (!this.#result) {
      throw selectionFault(
        `${plugin} selected view "${String(name)}" on ${routedSubject(path)}, which declares no result.`,
      );
    }
    if (typeof name !== 'string') {
      throw selectionFault(
        `${plugin} selected a view that is not a string on ${routedSubject(path)}.`,
      );
    }
    if (!this.#result.views.has(name)) {
      throw selectionFault(
        `${plugin} selected view "${name}", which ${routedSubject(path)} does not name.`,
      );
    }
    return name;
  }
}

/**
 * The default export a loader must resolve to. A loaded module is data core never declared, so the
 * check is the one runtime fact that decides it: the export is callable. Core calls it with the
 * context it owns and ignores whatever it returns.
 */
function isMiddlewareExport(value: unknown): value is (context: MiddlewareContext) => unknown {
  return typeof value === 'function';
}

/** One activated plugin in the chain, with the spellings of its own options its middleware reads. */
interface ChainEntry {
  identity: string;
  load: () => unknown;
  spellings: Readonly<Record<string, string>>;
}

/**
 * Whether one plugin's declared activation matched. A listed option activates when argv or an input
 * source supplied it, whatever value it holds, and a declared default never does.
 */
function activates(installed: BuiltPlugin, values: OptionValues): boolean {
  const { middleware } = installed;
  if (!middleware) {
    return false;
  }
  return (
    middleware.activate === 'always' || middleware.activate.some((name) => isSupplied(values, name))
  );
}

/**
 * The chain for one invocation: each installed plugin whose activation matched, in installation
 * order. Activation is read after the input-source stage and before any plugin code loads, so a
 * plugin whose option no tier supplied is not in the chain and its loader is never called.
 */
function activatedEntries(plugins: readonly BuiltPlugin[], values: OptionValues): ChainEntry[] {
  return plugins
    .filter((installed) => activates(installed, values))
    .map((installed) => ({
      identity: installed.identity,
      // Activation proved the middleware exists, so the empty loader is never the one core calls.
      load: installed.middleware?.load ?? (() => undefined),
      spellings: pluginSpellings(installed.inputs, values),
    }));
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

/**
 * Everything one invocation needs after its graph is built and its defaults and implied values are
 * validated.
 */
interface Invocation {
  style: ContextualStyle;
  /** The action's own channel, built from the routed Command's declaration when it dispatches. */
  channel: (binding: ResultBinding) => ActionChannel;
  graph: BuiltGraph;
  host: Host;
  /**
   * The graph `inspect()` returns, built at most once for the run. A configuration source reads
   * its requests from it, the chain reads it after the source, and an `onFailure` hook reads it too.
   */
  inspected: () => CommandGraph;
  /**
   * Offers one throw from the application's work to the translators, and answers with the failure
   * that replaces it, or `undefined` when none does. The chain offers a throw where it leaves the
   * chain, and a configuration source's throw is offered where the resolver's call settles.
   */
  offer: (thrown: unknown) => LoomError | undefined;
  /**
   * The invocation's own channel. A middleware reads it as the neutral `Out`, and the action
   * receives the channel the results lane builds for the Command that was routed.
   */
  out: Out<OpenResult>;
  /** The channel a configuration source receives, whose results call names the source. */
  sourceOut: Out<OpenResult>;
  /** Where every input of the graph was declared, which a broken validator's finding rebuilds. */
  places: InputPlaces;
  plugins: readonly BuiltPlugin[];
  /** Every declared default and implied value, validated before any token was read. */
  declaredValues: DeclaredValues;
  /** A fault reported after the primary outcome, which turns a would-be 0 into 1. */
  report: (fault: LoomError) => void;
  /**
   * The path routing walked, published as each name routes, which output names in its own line
   * and a failure view reads. An unknown Command leaves the partial path published.
   */
  route: (path: readonly string[]) => void;
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

/** The defect a view selection the routed Command cannot render reports. */
function selectionFault(sentence: string): InternalError {
  return new InternalError(viewSelection, {
    cause: undefined,
    correction: viewSelectionCorrection,
    sentence,
  });
}

/** A `next()` call that is no longer live: it dispatches nothing and rejects. */
function misuse(turn: EntryTurn): Promise<ChainOutcome> {
  const fault = new InternalError(nextMisuse, {
    cause: undefined,
    correction: 'Call next() once, and await it before the middleware returns.',
    sentence: `${pluginSentence(turn.entry.identity)} called next() ${turn.state.returned ? 'after its middleware returned' : 'twice'}.`,
  });
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
    // Core awaits the downstream promise itself.
    // A middleware that never awaits `next()` still holds the chain open.
    // The run therefore never ends with an unobserved rejection.
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
      chain.report(foreignFailure(thrown.value));
    }
  }
  if (state.calls === 0) {
    return reported(chain, 'taken-over');
  }
  await quiet(state.downstream);
  // A middleware that caught the rejection reports what the chain reached.
  // The recorded failure still decides the exit code.
  return reported(chain, state.outcome ?? (chain.invoked() ? 'dispatched' : 'taken-over'));
}

/** A plugin's module is loaded when the chain reaches it, never before. */
function loadMiddleware(entry: ChainEntry) {
  return loadDefault(entry.identity, entry.load, {
    guard: isMiddlewareExport,
    noun: 'middleware',
  });
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

/**
 * The whole chain, answering with the value it raised when a middleware caught that value. The
 * value is kept as it was thrown, so it is offered to the translators once, where it leaves.
 */
async function runChain(
  invocation: Invocation,
  routed: ParsedInvocation,
  prepared: Prepared,
): Promise<{ value: unknown } | undefined> {
  const entries = activatedEntries(invocation.plugins, prepared.globals);
  const run: { invoked: boolean; raised: { value: unknown } | undefined } = {
    invoked: false,
    raised: undefined,
  };
  const selection = new ViewSelection(prepared.result);
  /**
   * The dispatch boundary: the point the chain reaches when its last middleware continues. Core
   * raises the held fault here, so it ranks ahead of a bad view assignment, or else reads the
   * selected view and dispatches the action.
   */
  const terminal = async (): Promise<ChainOutcome> => {
    selection.reach();
    if (prepared.kind === 'held') {
      throw prepared.fault;
    }
    const view = selection.resolve(routed.path);
    run.invoked = true;
    await prepared.dispatch(view);
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
  const graph = invocation.inspected();
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
      options: prepared.options,
      out: invocation.out,
      request: prepared.request,
      signal: invocation.signal,
      spellings: entry.spellings,
      get view(): string | null {
        return selection.read();
      },
      set view(name: string) {
        selection.assign(entry.identity, name);
      },
    }),
    invoked: () => run.invoked,
    record: (error) => {
      run.raised ??= { value: error };
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
 * Runs one invocation: routing on the global options and a parent's own options, the routed
 * Command's words read against its table, the dispatch this invocation prepares, and the
 * middleware chain it then runs. Only an unknown Command is raised before the chain. Parsing and validation run ahead of the chain so
 * that a middleware reads the request, and every other fault they find is held until the dispatch
 * boundary. A middleware that returns without calling `next()` has taken over, so the held fault is
 * never raised and nothing later in the chain runs.
 */
async function runInvocation(invocation: Invocation): Promise<void> {
  const routed = parseInvocation(invocation.graph, invocation.host.argv, invocation.route);
  const prepared = await prepareDispatch(invocation.graph, routed, invocation);
  let raised: { value: unknown } | undefined = undefined;
  try {
    raised = await runChain(invocation, routed, prepared);
  } catch (error) {
    // A throw leaves the chain here, so a middleware that awaited next() saw it raw.
    throw invocation.offer(error) ?? error;
  }
  if (raised) {
    // The chain resolved because a middleware caught the rejection.
    // The failure it caught still decides the exit code.
    // That is the rule an action's caught output rejection already follows.
    throw invocation.offer(raised.value) ?? raised.value;
  }
}

export type { ChainOutcome, Invocation, MiddlewareContext };
export { runInvocation };
