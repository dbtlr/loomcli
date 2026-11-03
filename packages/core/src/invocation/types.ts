import type { LoomError } from '../failures/errors.js';
import type { FailureExitCode } from '../failures/exit-codes.js';
import type { FailureForm } from '../failures/form.js';
import type { Host } from '../host/types.js';
import type { Content } from '../inputs/content.js';
import type { SuppliedInputs } from '../inputs/types.js';
import type { CommandGraph, CommandNode } from '../inspection/inspect.js';
import type { Log } from '../output/log.js';
import type { OpenResult, Out, ProgressEvent } from '../output/types.js';
import type { OnResume, OnShutdown, OnSuspend } from '../signals/signal-lane.js';
import type { ContextualStyle } from '../style/style.js';

type ActionArgument<Declaration> =
  ActionHandler<Declaration> extends (context: infer Context) => unknown ? Context : never;

/** The context fragment a stdin declaration contributes to its action. */
interface StdinContext {
  readonly stdin?: Content | undefined;
}

/**
 * The routed Command's invocation after parsing and validation, which every middleware reads. The
 * values are what the action receives, the output of each declaration's schema, for that Command's
 * own arguments and local options; global option values are not here. The records are
 * untyped and frozen, because a middleware runs ahead of every action and the graph carries no
 * type for a value.
 */
export interface Request {
  readonly stdin?: Content | undefined;
  readonly args: Readonly<Record<string, unknown>>;
  readonly options: Readonly<Record<string, unknown>>;
  readonly passthrough: readonly string[];
}

/** The channel one action receives, with the emission the results lane holds it to. */
export interface ActionChannel {
  out: Out<OpenResult>;
  /** Whether the action emitted its result, which the missing rule reads after it returned. */
  emitted: () => boolean;
  /**
   * Stops every sequence this channel still has pending. The action's own failure stays primary,
   * so a sequence it never awaited is stopped rather than drained.
   */
  stop: () => void;
  /** Closes every region the action opened that is still open, because the action returned. */
  complete: () => void;
  /** Closes every region the action opened that is still open, because the action threw. */
  fail: () => void;
}

/**
 * The values an invocation by name supplies, mirroring the action context: `args` keyed by argument
 * name, `options` by the declared name of a local or global option, and the passthrough tail. Each
 * value lowers to the tokens argv would give: a string or a number is one token, a Boolean a
 * spelling or its absence, a number on a counted option that many occurrences, and an array one
 * occurrence per element.
 */
export interface InvocationValues {
  readonly args?: Readonly<
    Record<string, string | number | boolean | readonly (string | number)[] | undefined>
  >;
  readonly options?: Readonly<
    Record<string, string | number | boolean | readonly (string | number)[] | undefined>
  >;
  readonly passthrough?: readonly string[];
}

/**
 * How one invocation by name runs: the starting view selection, the handler that maps a failure
 * into the outcome, a signal that cancels the call, and the observer of its progress events.
 */
export interface InvokeOptions<Mapped = LoomError> {
  /** The starting view selection, as a middleware's `view` assignment. */
  readonly view?: string;
  readonly failure?: (
    failure: Readonly<LoomError>,
    context: {
      readonly application: string;
      readonly path: readonly string[];
      readonly exitCode: FailureExitCode;
      /** The failure's form, the same object the failed outcome carries. */
      readonly form: FailureForm;
    },
  ) => Mapped;
  /** Composed with the parent run's signal when an action calls `invoke`. */
  readonly signal?: AbortSignal;
  /**
   * Receives each progress event of the call's run, in order, inside the report or the region close
   * that built it. A throw stops it, and `invoke` rejects with that throw once the run settles.
   */
  readonly onProgress?: (event: ProgressEvent) => void;
  /**
   * Options the call leaves out of its run, by declared name: no tier supplies one, so a key of
   * `options` that names one is an unknown option and the input-source stage reads nothing for it.
   * A name the routed Command's table does not hold is an unknown option too.
   */
  readonly exclude?: readonly string[];
}

/**
 * What one invocation by name resolved: a run that would resolve 0, one that would resolve a failure
 * code, with what the run wrote, or a cancelled one, whose captured text is discarded.
 */
export type InvocationOutcome<Mapped = LoomError> =
  | { readonly status: 'completed'; readonly output: string; readonly messages: string }
  | {
      readonly status: 'failed';
      readonly failure: Mapped;
      /** The form of the failure the handler received. */
      readonly form: FailureForm;
      readonly exitCode: FailureExitCode;
      readonly output: string;
      readonly messages: string;
    }
  | { readonly status: 'cancelled'; readonly exitCode: 129 | 130 | 131 | 141 | 143 };

/**
 * What an action receives. `graph` is the frozen graph `inspect()` returns for this run, and
 * `command` is the routed node inside it: the same two values the run's middleware receive.
 * `invoke` runs another Command of that graph by name.
 */
export interface ActionContext<Args, Options = {}, Result = unknown, Provided = {}> {
  readonly interactive: boolean;
  readonly supplied: SuppliedInputs;
  readonly cancel: () => void;
  readonly stdin?: Content | undefined;
  readonly style: ContextualStyle;
  args: Args;
  options: Options;
  readonly graph: CommandGraph;
  readonly command: CommandNode;
  passthrough: string[];
  out: Out<Result>;
  host: Host;
  /** Records a log event for every installed plugin's `onLog` hook, under no plugin. */
  readonly log: Log;
  /** The run's cancellation signal, which a caller, a shutdown, the action, or a closed pipe aborts. */
  signal: AbortSignal;
  /**
   * Registers a synchronous handler that runs once, at the end of a shutdown or of the process, and
   * is removed when the run ends while no shutdown is under way. Answers the call that removes it.
   */
  readonly onShutdown: OnShutdown;
  /** Registers a synchronous handler that runs when Ctrl-Z suspends the process, until the run ends. */
  readonly onSuspend: OnSuspend;
  /** Registers a synchronous handler that runs when the process resumes, until the run ends. */
  readonly onResume: OnResume;
  /** The value of each provider the Command's `uses` lists, under its provider's name. */
  readonly provided: Provided;
  /** Runs another Command of the graph this run built, by name, and captures what it writes. */
  readonly invoke: <Mapped = LoomError>(
    path: readonly string[],
    values: InvocationValues,
    options?: InvokeOptions<Mapped>,
  ) => Promise<InvocationOutcome<Mapped>>;
}

export type Action<
  Args,
  Options = {},
  Result = unknown,
  Stdin extends StdinContext = StdinContext,
  Provided = {},
> = (context: Omit<ActionContext<Args, Options, Result, Provided>, 'stdin'> & Stdin) => unknown;

/** Phantom key. It keeps the inferred declaration types exact and holds no runtime value. */
export declare const declaredTypes: unique symbol;

/**
 * Arguments and local options describe the action's own inputs. Globals are a requirement on the
 * Receiving Application: a library that needs none can attach wherever its local keys are disjoint.
 */
export interface DeclaredTypes<
  Args,
  Options,
  Globals,
  Result = unknown,
  Stdin extends StdinContext = StdinContext,
  Provided = {},
> {
  stdin: Stdin;
  args: Args;
  globals: (value: Globals) => void;
  options: Options;
  /** The values the Command's opt-ins provide. A plain field keeps it covariant, as `result` is. */
  provided: Provided;
  /**
   * The result the Command declares, or `unknown` where it declares none. A plain field keeps it
   * covariant, so a child that carries one still satisfies a neutral `Command` annotation.
   */
  result: Result;
}

/**
 * The handler one declaration accepts. It reads the phantom types, not the `action()` call, so it
 * holds on a fresh declaration, on a partly declared one, and on one that registered its action.
 */
export type ActionHandler<Declaration> = Declaration extends {
  [declaredTypes]: DeclaredTypes<
    infer Args,
    infer Options,
    infer Globals,
    infer Result,
    infer Stdin,
    infer Provided
  >;
}
  ? Action<Args, Globals & Options, Result, Stdin, Provided>
  : never;

/** The args object an extracted handler receives for this declaration. */
export type ActionArgs<Declaration> =
  ActionArgument<Declaration> extends { args: infer Args } ? Args : never;

/** The options object an extracted handler receives, global values included. */
export type ActionOptions<Declaration> =
  ActionArgument<Declaration> extends { options: infer Options } ? Options : never;

export type { StdinContext };
