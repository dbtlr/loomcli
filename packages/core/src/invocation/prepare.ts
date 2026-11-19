import type { BuiltGraph } from '../commands/build.js';
import { frozenValues } from '../commands/globals.js';
import { optionsOf } from '../commands/inputs.js';
import type { DispatchInput, BuiltCommand } from '../commands/types.js';
import type { InvokedBy, LoomError } from '../failures/errors.js';
import {
  NonCallableCommandError,
  ResultError,
  TerminalUnavailableError,
  toFailure,
} from '../failures/errors.js';
import { underCI } from '../host/host.js';
import type { Host } from '../host/types.js';
import type { Content } from '../inputs/content.js';
import type {
  InputPlaces,
  DeclaredValues,
  OptionInput,
  InputDeclaration,
  Provenance,
} from '../inputs/declarations.js';
import type { ValidatedInputs } from '../inputs/ledger.js';
import { ValidationLedger } from '../inputs/ledger.js';
import { rememberInputNames } from '../inputs/missing-input.js';
import type { OptionValues } from '../inputs/options.js';
import {
  copyValues,
  emptyValues,
  mergeValues,
  isSupplied,
  booleanValue,
  withdrawFill,
} from '../inputs/options.js';
import type { SourceOutcome } from '../inputs/sources.js';
import { fillInputs } from '../inputs/sources.js';
import { suppliedInputs } from '../inputs/supplied.js';
import type { Validation } from '../inputs/validation.js';
import { validateValues, rejectsGlobal } from '../inputs/validation.js';
import type { CommandGraph, OptionNode } from '../inspection/inspect.js';
import { nodeAt, graphMismatch } from '../inspection/inspect.js';
import { interaction } from '../marks/interaction.js';
import { isMarked } from '../marks/marks.js';
import type { LogBinder } from '../output/log.js';
import type {
  ResultBinding,
  Out,
  OpenResult,
  DeclaredResult,
  ResultTransform,
} from '../output/types.js';
import type { OpenerScope, RunValues, AnyProvider, BuildOutcome } from '../plugins/providers.js';
import type { LaneHandlers } from '../signals/signal-lane.js';
import { echoesCancellation } from '../signals/signals.js';
import type { ContextualStyle } from '../style/style.js';
import { snapshot } from '../support/plain.js';
import type { ParsedInvocation } from './parse.js';
import { candidatesOf } from './parse.js';
import type { ActionChannel, Request, ActionContext } from './types.js';
/** What one invocation reaches the middleware chain with. */
export interface DispatchInvocation {
  cancel: () => void;
  /**
   * The `onShutdown`, `onSuspend`, and `onResume` of one context of the run, bound to the plugin
   * core is calling, or to none.
   */
  laneHandlers: (plugin: string | null) => LaneHandlers;
  /** The channel the action receives, which the results lane builds from the routed node. */
  channel: (binding: ResultBinding) => ActionChannel;
  host: Host;
  /** Where every input of the graph was declared, which a broken validator's finding rebuilds. */
  places: InputPlaces;
  /** Every declared default and implied value, validated before any token was read. */
  declaredValues: DeclaredValues;
  /** The graph `inspect()` returns for the run, built on its first read, which a source reads. */
  inspected: () => CommandGraph;
  /** How the run received its inputs, which names every input a problem reports. */
  invokedBy: InvokedBy;
  /** Runs another Command of this run's graph by name, which the action receives. */
  invoke: DispatchInput['invoke'];
  /** Gives a context of the run its `log`, bound to the plugin core is calling, or to none. */
  logFor: LogBinder;
  /** Offers a configuration source's foreign throw to the translators where its call settles. */
  offer: (thrown: unknown) => LoomError | undefined;
  signal: AbortSignal;
  /** The channel a configuration source writes through. */
  out: Out<OpenResult>;
  style: ContextualStyle;
  /**
   * The provided values of this run, whose openers read the scope given: this run's ephemeral
   * values, and the persistent values of its outermost run.
   */
  providers: (scope: OpenerScope) => RunValues;
  /**
   * Rejects with a failure core holds, which the run reports after the chain settles when no code
   * observes the rejection, as an opener's rejection after its run was cancelled is.
   */
  handFailure: (fault: unknown) => Promise<never>;
}

/** Whether the boundary dispatched the action, or a cancellation during the build stopped it first. */
export type DispatchOutcome = 'dispatched' | 'cancelled';

/**
 * One invocation prepared ahead of the middleware chain. `'ready'` carries the request a middleware
 * reads and the call that dispatches; `'held'` carries the fault this phase found, which core
 * raises at the dispatch boundary and never before, so a takeover swallows it. `result` is what the
 * routed Command declared, whose views a middleware selects among, on either shape. `globals` holds
 * the globals table's values after the input-source stage, which activation and each plugin's
 * spellings read on either shape. `options` is every global option's validated value, which every
 * middleware reads, or `null` when a global option has a structural fault or was rejected, or the
 * values could not be read. `own` answers one plugin's `ownOptions`: each option the plugin
 * declared, its own global options and the local options its hook declared on the routed Command,
 * that validated in this run, whatever fault is held for another input.
 */
export type Prepared = {
  globals: OptionValues;
  options: Readonly<Record<string, unknown>> | null;
  own: (identity: string, inputs: readonly OptionInput[]) => Readonly<Record<string, unknown>>;
  result: DeclaredResult | undefined;
} & (
  | {
      dispatch: (
        view: string | null,
        transform: ResultTransform | undefined,
        invoked: () => void,
      ) => Promise<DispatchOutcome>;
      kind: 'ready';
      request: Request;
    }
  | { fault: unknown; kind: 'held'; request: null }
);

/**
 * The frozen records one middleware reads: the routed Command's own inputs, and the tail. Every
 * value is a plain-data copy frozen to every depth, so a middleware that reaches into a list or a
 * schema's output object reaches its own copy and contributes nothing to what the action receives.
 * A value that is neither an array nor a plain object, a class instance or a `Date` a schema
 * produced, is shared by reference, because core cannot copy it meaningfully.
 */
function requestOf(
  command: BuiltCommand,
  values: ValidatedInputs,
  { passthrough, stdin }: { passthrough: readonly string[]; stdin: Content | undefined },
): Request {
  const args: Record<string, unknown> = {};
  const options: Record<string, unknown> = {};
  for (const input of command.inputs) {
    const target = input.kind === 'argument' ? args : options;
    target[input.name] = snapshot(values.read(input));
  }
  return Object.freeze({
    ...(command.stdin !== undefined ? { stdin } : {}),
    args: Object.freeze(args),
    options: Object.freeze(options),
    passthrough: Object.freeze([...passthrough]),
  });
}

/** The routed Command's own values after parsing, or the fault parsing or the callable check holds. */
type LocalPhase =
  | {
      args: ReadonlyMap<InputDeclaration, string | string[]>;
      dispatch: (input: DispatchInput) => unknown;
      kind: 'parsed';
      options: OptionValues;
      passthrough: string[];
    }
  | { fault: unknown; kind: 'held' };

/**
 * The held structural fault, then the callable check. A group answers no invocation of its own, so
 * it holds the missing-subcommand error, which ranks after every structural fault.
 */
function parseLocal(routed: ParsedInvocation): LocalPhase {
  const { command, fault, path } = routed;
  const { dispatch } = command;
  if (fault) {
    return { fault, kind: 'held' };
  }
  if (!dispatch) {
    return {
      fault: new NonCallableCommandError(path, candidatesOf(command), routed.escapable),
      kind: 'held',
    };
  }
  return {
    args: routed.args,
    dispatch,
    kind: 'parsed',
    options: routed.values.locals,
    passthrough: routed.passthrough,
  };
}

/**
 * The node of one option a configuration source is asked about: in the graph's globals, or among
 * the routed Command's own options. Build published every declaration, so a missing node means the
 * two readings of one graph disagree.
 */
function requestNode(
  graph: CommandGraph,
  path: readonly string[],
  place: { global: boolean; name: string },
): OptionNode {
  const options = place.global ? graph.globals : nodeAt(graph, path).options;
  const node = options.find((option) => option.name === place.name);
  if (!node) {
    throw graphMismatch(`Option "${place.name}" is not in the inspected graph.`);
  }
  return node;
}

/**
 * The one invocation every phase ahead of the chain reads: the graph, the route, the run, and what
 * the run's validation passes settled, which each later pass reads so a validator runs at most once.
 */
interface Preparation {
  interactive: boolean;
  graph: BuiltGraph;
  invocation: DispatchInvocation;
  ledger: ValidationLedger;
  routed: ParsedInvocation;
}

/**
 * The routed Command's own parsed inputs a validation pass reads: its arguments, its local option
 * values, and its passthrough tail. A pass whose locals were held reads none.
 */
interface LocalScope {
  readonly args: ReadonlyMap<InputDeclaration, string | string[]>;
  readonly options: OptionValues;
  readonly passthrough: readonly string[];
}

/**
 * The input-source stage over this run's own copies of the parsed values. The global options fill
 * whatever was held, and a faulted occurrence supplied nothing, so a source may fill its option;
 * the routed Command's own options fill only when nothing is held, because the request is `null`
 * otherwise. A configuration source's own options pass their validators before the source is
 * called, as a pass over those options alone.
 */
async function fillScope(
  preparation: Preparation,
  local: LocalPhase,
): Promise<{ globals: OptionValues; scope: LocalScope | undefined; sources: SourceOutcome }> {
  const { graph, invocation, routed } = preparation;
  const globals = copyValues(routed.values.globals);
  const locals = copyValues(local.kind === 'parsed' ? local.options : emptyValues());
  const scope =
    local.kind === 'parsed'
      ? { args: local.args, options: locals, passthrough: local.passthrough }
      : undefined;
  // An option the call excludes is out of the stage's scope: no variable is read and no source asked.
  const inScope = <Input extends { name: string }>(inputs: readonly Input[]) =>
    inputs.filter((input) => !routed.excluded.has(input.name));
  const sources = await fillInputs({
    extensions: graph.extensions,
    globals: { global: true, inputs: inScope(graph.globals.inputs), values: globals },
    groups: local.kind === 'parsed' ? routed.command.optionGroups : [],
    host: invocation.host,
    inspected: invocation.inspected,
    invokedBy: invocation.invokedBy,
    locals:
      local.kind === 'parsed'
        ? { global: false, inputs: inScope(optionsOf(routed.command.inputs)), values: locals }
        : undefined,
    log: invocation.logFor,
    offer: invocation.offer,
    out: invocation.out,
    plugins: graph.globals.plugins,
    request: (input, global) =>
      requestNode(invocation.inspected(), routed.path, { global, name: input.name }),
    signal: invocation.signal,
    style: invocation.style,
    validate: (inputs, provenance) =>
      validateInvocation(preparation, {
        local: scope,
        only: new Set(inputs),
        sources: provenance,
        values: globals,
      }),
  });
  return { globals, scope, sources };
}

/**
 * A validation pass over the values the input-source stage has filled: every global option
 * whatever was held, and the routed Command's own declarations only when the pass reads its local
 * scope, which the run's one pass does when nothing is held and the Command is not a group. `only`
 * narrows the declarations a pass validates, as the pass over a configuration source's own options
 * does ahead of its call and the pass over the plugins' own options under a held fault does,
 * while every validator reads the same context. Each pass reads what an earlier pass of the run
 * settled through the ledger rather than validating it again.
 */
function validateInvocation(
  { graph, invocation, interactive, ledger, routed }: Preparation,
  filled: {
    local: LocalScope | undefined;
    only?: ReadonlySet<InputDeclaration>;
    sources: Provenance;
    values: OptionValues;
  },
): Promise<Validation> {
  const { local, only, sources } = filled;
  return validateValues({
    command: routed.path,
    declaredValues: invocation.declaredValues,
    host: invocation.host,
    inputs: { globals: graph.globals.inputs, locals: local ? routed.command.inputs : [] },
    interactive,
    ledger,
    named: invocation.invokedBy === 'name' ? { unlowered: routed.unlowered } : undefined,
    optionGroups: local && only === undefined ? routed.command.optionGroups : [],
    passthrough: local?.passthrough ?? [],
    places: invocation.places,
    signal: invocation.signal,
    sources,
    stdin: local ? routed.command.stdin : undefined,
    supplied: {
      args: local?.args ?? new Map(),
      options: local ? mergeValues(filled.values, local.options) : filled.values,
    },
    table: routed.command.table,
    ...(only ? { only } : {}),
  });
}

/**
 * The options of the plugins that a held fault left unvalidated and that core still validates for
 * `ownOptions`: each plugin's global options, and each local option a hook declared on the routed
 * Command, a group included, whose tokens parsed, none of whose occurrences faulted, and that no
 * earlier pass reached. An author's option on a group is never validated, because it reaches no
 * action. Under a validation problem the run's own pass
 * validated every one of them, so only a structural fault, an input-source fault, or a validator
 * that threw leaves any to add. An option whose validator threw was reached, so it is never
 * validated again.
 */
function ownUnderFault({ graph, ledger, routed }: Preparation): ReadonlySet<InputDeclaration> {
  const { command, faulted, values } = routed;
  const parsed = (input: OptionInput, supplied: OptionValues) =>
    isSupplied(supplied, input.name) && !faulted.has(input.name) && !ledger.reached(input);
  const globals = graph.globals.plugins
    .flatMap(({ inputs }) => inputs)
    .filter((input) => parsed(input, values.globals));
  const attached = command.inputs.filter(
    (input) =>
      input.kind === 'option' && command.attachedBy.has(input) && parsed(input, values.locals),
  );
  return new Set([...globals, ...attached]);
}

/**
 * The pass over the plugins' options a held fault left unvalidated, for `ownOptions` alone: the
 * held fault stays the one raised whatever the validators answer, so a rejection, and a validator
 * that throws, leave the option absent and report nothing. The ledger keeps what this pass
 * settled before a throw, so the options validated ahead of it stand.
 */
async function validateOwn(preparation: Preparation, globals: OptionValues): Promise<void> {
  const { routed } = preparation;
  const only = ownUnderFault(preparation);
  if (only.size === 0) {
    return;
  }
  try {
    await validateInvocation(preparation, {
      local: { args: routed.args, options: copyValues(routed.values.locals), passthrough: [] },
      only,
      sources: { labels: new Map(), rejected: new Map() },
      values: globals,
    });
  } catch {
    // The held fault is the one raised, so a broken validator here reports nothing.
  }
}

/**
 * The record one plugin's middleware reads under `ownOptions`: each of the plugin's own global
 * options, and each local option its hook declared on the routed Command, that a pass of the run
 * validated, keyed by declared name. An option with an occurrence that faulted is absent, and so
 * is one no pass validated. Each value is a copy frozen to every depth, as under `options`.
 */
function ownRecord(routed: ParsedInvocation, validated: ValidatedInputs): Prepared['own'] {
  return (identity, inputs) => {
    const { command, faulted } = routed;
    const attached = command.inputs.filter(
      (input) => input.kind === 'option' && command.attachedBy.get(input) === identity,
    );
    const record: Record<string, unknown> = {};
    for (const input of [...inputs, ...attached]) {
      if (validated.has(input) && !faulted.has(input.name)) {
        record[input.name] = snapshot(validated.read(input));
      }
    }
    return Object.freeze(record);
  };
}

/**
 * The dispatch a clean validation prepares. It answers with the call that dispatches, so the caller
 * records that the action was invoked at the moment it invokes it and no earlier failure reads as a
 * dispatch.
 */
function readyDispatch(
  { graph, invocation, interactive, routed }: Preparation,
  local: LocalPhase & { kind: 'parsed' },
  {
    options,
    values,
    stdin,
    supplied,
  }: Pick<Validation, 'values' | 'stdin'> & {
    options: Readonly<Record<string, unknown>> | null;
    supplied: ActionContext<unknown>['supplied'];
  },
): {
  dispatch: (
    view: string | null,
    transform: ResultTransform | undefined,
    invoked: () => void,
  ) => Promise<DispatchOutcome>;
  request: Request;
} {
  const { command, path } = routed;
  const [top] = path;
  // An action under a plugin Command logs as that plugin, and the application's own as none.
  const plugin = (top === undefined ? undefined : graph.listedBy.get(top)) ?? null;
  return {
    dispatch: async (view, transform, invoked) => {
      const { signal } = invocation;
      const runValues = invocation.providers({
        graph: invocation.inspected,
        host: invocation.host,
        invokedBy: invocation.invokedBy,
        log: invocation.logFor(null),
        onShutdown: invocation.laneHandlers(null).onShutdown,
        options: options ?? Object.freeze({}),
        out: invocation.out,
        signal,
        style: invocation.style,
      });
      const built = await buildProvided(runValues, command.uses);
      if (built.kind === 'cancelled') {
        /**
         * The action is never dispatched. A rejection that echoes the cancellation is silent, and
         * any other is reported once the chain settles, with the signal's code.
         */
        const { rejected } = built;
        if (rejected !== undefined && !echoesCancellation(rejected.thrown, signal)) {
          void invocation.handFailure(rejected.thrown);
        }
        return 'cancelled';
      }
      // The channel is built at the boundary, because the view a middleware selected is read there.
      const channel = invocation.channel({ path, result: command.result, transform, view });
      try {
        rememberInputNames(invocation.host, invocation.invokedBy);
        invoked();
        await local.dispatch({
          cancel: invocation.cancel,
          // The run builds its graph once, so every read answers the same node.
          command: () => nodeAt(invocation.inspected(), path),
          graph: invocation.inspected,
          host: invocation.host,
          interactive,
          invoke: invocation.invoke,
          log: invocation.logFor(plugin),
          ...invocation.laneHandlers(null),
          out: channel.out,
          passthrough: local.passthrough,
          provided: built.values,
          signal: invocation.signal,
          stdin,
          style: invocation.style,
          supplied,
          values,
        });
        // The action returned, so each region it left open closes for its completion.
        channel.complete();
        /**
         * A declared result is a promise the Command makes, so an action that returned normally
         * without emitting one broke it. A failure raised before the call is that failure, and a
         * cancelled run raises none, because an action that reads its signal and returns is the
         * sanctioned path.
         */
        if (command.result && !channel.emitted() && !invocation.signal.aborted) {
          throw new ResultError('missing', path);
        }
      } catch (error) {
        // The action's failure is the invocation's outcome.
        // A sequence it left pending is stopped where it stands rather than drained to its end.
        channel.stop();
        // Each region the action left open writes its last frame before its values close.
        channel.fail();
        await runValues.close(false);
        throw error;
      }
      // A close that throws fails a run that had otherwise succeeded, as an action's throw does.
      const closed = await runValues.close(!signal.aborted);
      if (closed !== undefined) {
        throw closed.thrown;
      }
      return 'dispatched';
    },
    request: requestOf(command, values, { passthrough: local.passthrough, stdin }),
  };
}

/**
 * Builds the routed Command's opt-ins. A build that throws on a live run closes what it built and
 * rejects, so the failure takes the ordinary failure path; a cancelled one closes what it built.
 */
async function buildProvided(
  runValues: RunValues,
  uses: readonly AnyProvider[],
): Promise<BuildOutcome> {
  const built = await runValues.build(uses).catch(async (error: unknown) => {
    await runValues.close(false);
    throw error;
  });
  if (built.kind === 'cancelled') {
    await runValues.close(false);
  }
  return built;
}

/**
 * Whether the run has a terminal, the test the interaction decision and a Command that needs a
 * terminal share: stdin and stderr are terminals, and the run is not under CI. Stdout plays no part.
 */
function atTerminal(host: Host): boolean {
  return host.terminal.stdin.isTTY && host.terminal.stderr.isTTY && !underCI(host.env);
}

/**
 * Prepares one dispatch ahead of the middleware chain and holds whatever fault it found, so a
 * middleware reads the request before the action runs and a takeover never observes the fault.
 * The phases run in order: the structural fault parsing held, a group's missing subcommand, the
 * input-source stage, and validation. Either of the first two outranks a configuration source's
 * fault, and a source's fault takes the place of every validation problem. Validation checks the
 * global options whatever was held, so a middleware reads them after a local fault; a structural
 * fault on a global option, a rejected global option, a source's fault, or a validator's own fault
 * leaves `options` `null`.
 */
export async function prepareDispatch(
  graph: BuiltGraph,
  routed: ParsedInvocation,
  invocation: DispatchInvocation,
): Promise<Prepared> {
  const result = routed.command.result;
  const local = parseLocal(routed);
  const ledger = new ValidationLedger();
  const preparation = { graph, interactive: false, invocation, ledger, routed };
  const { globals, scope, sources } = await fillScope(preparation, local);
  const marked = graph.globals.inputs.find((input) => isMarked(input.config, interaction));
  const terminal = atTerminal(invocation.host);
  preparation.interactive =
    terminal && (marked === undefined || booleanValue(globals, marked.name, marked.config));
  const held = async (fault: unknown, options: Prepared['options']): Promise<Prepared> => {
    await validateOwn(preparation, globals);
    return {
      fault: local.kind === 'held' ? local.fault : fault,
      globals,
      kind: 'held',
      options,
      own: ownRecord(routed, ledger.values),
      request: null,
      result,
    };
  };
  if (sources.fault) {
    return held(sources.fault, null);
  }
  try {
    const validation = await validateInvocation(preparation, {
      local: scope,
      sources,
      values: globals,
    });
    const options =
      routed.globalFault || rejectsGlobal(validation)
        ? null
        : frozenValues(graph.globals.inputs, validation.values);
    // The supplied record keeps every value a source filled, so it is taken before a drop.
    const supplied =
      local.kind === 'held' || validation.failure
        ? undefined
        : suppliedInputs(
            [...graph.globals.inputs, ...routed.command.inputs],
            {
              args: scope?.args ?? new Map(),
              options: scope ? mergeValues(globals, scope.options) : globals,
            },
            true,
          );
    for (const [input, line] of validation.dropped) {
      withdrawFill(globals, input.name);
      if (scope) {
        withdrawFill(scope.options, input.name);
      }
      invocation.logFor(null).debug(line.template, line.fields);
    }
    // A Command that needs a terminal fails without one, ahead of the input problems validation collected.
    if (routed.command.needsTerminal && !terminal) {
      return await held(
        new TerminalUnavailableError(invocation.inspected().name, routed.path),
        options,
      );
    }
    if (local.kind === 'held' || supplied === undefined) {
      return await held(validation.failure, options);
    }
    const ready = readyDispatch(preparation, local, { ...validation, options, supplied });
    return {
      ...ready,
      globals,
      kind: 'ready',
      options,
      own: ownRecord(routed, ledger.values),
      result,
    };
  } catch (error) {
    // The fault is held as a failure, so a throw from reading a validator's output is never offered.
    return await held(toFailure(error), null);
  }
}
