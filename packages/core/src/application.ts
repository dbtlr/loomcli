import type { Writable } from 'node:stream';

import { runInvocation } from './chain.js';
import {
  attachChild,
  buildGraph,
  collectInputs,
  declareAction,
  declareExtensions,
  declareArgument,
  declareOption,
  declareResult,
  declareResultViews,
  freshState,
  recordGlobalOption,
} from './command.js';
import type {
  AfterAction,
  AttachmentConstraint,
  AfterArgument,
  AfterCommand,
  AfterResult,
  BuiltGraph,
  Command,
  CommandMethod,
  CommandState,
  ResultMethod,
} from './command.js';
import type { ApplicationEnvironment, applicationEnvironment } from './environment.js';
import { DeclarationError, InternalError, reasonOf, toFailure } from './errors.js';
import type { LoomError } from './errors.js';
import type { ExtensionValue } from './extension.js';
import { checkDescription, checkNoListingFacts, checkVersion, isPlainObject } from './facts.js';
import { declareGlobalOption, emptyGlobals } from './globals.js';
import type { GlobalsState } from './globals.js';
import { captureHost } from './host.js';
import { inspectGraph } from './inspect.js';
import type { CommandGraph } from './inspect.js';
import { coreViews } from './lanes.js';
import { Output, reportPlainly } from './output.js';
import { buildPlugins, installPlugins, ownedSignals, pluginSentence } from './plugin.js';
import type { BuiltPlugin, Plugin, PluginBuild } from './plugin.js';
import { renderingPolicy } from './rendering.js';
import type { RenderingPolicy } from './rendering.js';
import { bracketRun, cancellationCode, isCancellationEcho } from './signals.js';
import type { CancellationCode, SignalBracket } from './signals.js';
import type {
  Action,
  ArgumentConfig,
  ArgumentValue,
  declaredTypes,
  DeclaredTypes,
  DefaultConstraint,
  GlobalNameConstraint,
  MultipleConstraint,
  NameConstraint,
  ExitCode,
  OptionConfig,
  OptionValue,
  ResultViews,
  ResultViewsOf,
  RowViews,
  RunOptions,
  ValidateOmittedConstraint,
} from './types.js';
import type { ArgumentInput, OptionInput } from './validation.js';
import { captureConfig, checkDeclarations, prepareInputs } from './validation.js';
import { buildViews, describeFailure, viewIdentities } from './view.js';
import type { ViewOverride, ViewRegistry } from './view.js';

/**
 * Every authoring call an Application can publish, beside `run()` and `name`, which always remain.
 * An Application's type state is a subset of these, and each call removes the names it invalidates.
 * The unnamed root declares what a named Command declares, except for `alias()`: the root answers
 * to no bare token, so it has no name to alias.
 */
export type ApplicationMethod = Exclude<CommandMethod, 'alias'> | 'globalOption';

/** The registry a failure is reported through when the application's own could not be built. */
const noViews: ViewRegistry = [];

/**
 * What one preparation hands back as each stage of the build passes, in the order it passes them.
 * `inspect()` ignores every stage; `run()` uses them to configure the invocation's output as soon
 * as the declarations that decide it have been validated.
 */
interface PrepareStage {
  /** Each registry as it is published: the application's alone, then the merged one. */
  views: (registry: ViewRegistry) => void;
  /** The validated declared rendering policy, before any other declaration is read. */
  rendering: (policy: RenderingPolicy) => void;
  /** The built plugins, which carry the theme the view context resolves styles through. */
  plugins: (plugins: readonly BuiltPlugin[]) => void;
}

/**
 * Whether one failure is the cancellation the run already reports, which core does not report a
 * second time. Any other failure after cancellation is rendered as usual.
 */
function silenced(
  thrown: unknown,
  signal: AbortSignal,
  cancelled: CancellationCode | undefined,
): boolean {
  return cancelled !== undefined && isCancellationEcho(thrown, signal.reason);
}

/**
 * Whether the primary outcome carries one recorded cause already: the value itself, or a failure
 * that wraps it at any depth, which an action that caught a source failure and rethrew its own
 * produces. Such a cause is reported once, through the primary outcome that carries it.
 */
function carried(primary: unknown, cause: unknown): boolean {
  const seen = new Set<unknown>();
  let value = primary;
  while (value !== undefined && !seen.has(value)) {
    if (value === cause) {
      return true;
    }
    seen.add(value);
    value = value instanceof Error ? value.cause : undefined;
  }
  return false;
}

/**
 * The caller's own signal, read where it enters. A JavaScript caller reaches the slot with any
 * value, and a value that is not an `AbortSignal` would otherwise escape as a raw TypeError.
 */
function checkSignal(signal: unknown): AbortSignal | undefined {
  if (signal === undefined) {
    return undefined;
  }
  if (!(signal instanceof AbortSignal)) {
    throw new InternalError(
      'run() received a signal that is not an AbortSignal. Supply the signal of an AbortController.',
      undefined,
    );
  }
  return signal;
}

export interface ApplicationOptions<Plugins extends readonly Plugin[] = readonly Plugin[]> {
  rendering?: RenderingPolicy;
  views?: readonly ViewOverride[];
  plugins?: Plugins;
  extensions?: readonly ExtensionValue<'command'>[];
  description?: string;
  version?: string;
}

/**
 * The Application holds the unnamed root's declaration state and applies the same transitions a
 * Command does, so each declaration call has one typed implementation and no builder to recover.
 */
class ApplicationBuilder<
  Args,
  Options,
  Globals,
  State extends ApplicationMethod = ApplicationMethod,
  Plugins extends readonly Plugin[] = readonly [],
  Result = unknown,
> {
  declare readonly [applicationEnvironment]: ApplicationEnvironment<Globals, Plugins>;
  declare readonly [declaredTypes]: DeclaredTypes<Args, Options, Globals, Result>;

  readonly #name: string;
  readonly #root: CommandState<Args, Options, Globals>;
  // The override list the constructor read out of the options slot, unexamined until build.
  readonly #views: unknown;
  readonly #plugins: Plugins | undefined;
  readonly #globals: GlobalsState<Globals>;
  // The constructor's raw options argument, kept for the slot's own shape rules.
  // The options-slot rules answer at the same point every other authoring fault does:
  // `inspect()` and `run()`.
  readonly #options: unknown;
  // The facts the constructor read out of that slot, unexamined until build.
  readonly #declared: DeclaredFacts;

  constructor(
    name: string,
    root: CommandState<Args, Options, Globals>,
    config: {
      declared: DeclaredFacts;
      views: unknown;
      options?: unknown;
      plugins: Plugins | undefined;
      globals: GlobalsState<Globals>;
    },
  ) {
    this.#declared = config.declared;
    this.#views = config.views;
    this.#name = name;
    this.#options = config.options;
    this.#plugins = config.plugins;
    this.#globals = config.globals;
    this.#root = root;
  }

  get name(): string {
    return this.#name;
  }

  argument<const Name extends string, const Config extends ArgumentConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      NoInfer<DefaultConstraint<Config>> &
      NoInfer<ValidateOmittedConstraint<Config>>,
  ): Application<
    Args & Record<Name, ArgumentValue<Config>>,
    Options,
    Globals,
    AfterArgument<State>,
    Plugins,
    Result
  > {
    const input: ArgumentInput<Name, Config> = {
      config: captureConfig(config),
      kind: 'argument',
      name,
    };
    return this.derive(declareArgument(this.#root, input));
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      GlobalNameConstraint<Name, Globals> &
      NoInfer<DefaultConstraint<Config>> &
      NoInfer<MultipleConstraint<Config>> &
      NoInfer<ValidateOmittedConstraint<Config>>,
  ): Application<
    Args,
    Options & Record<Name, OptionValue<Config>>,
    Globals,
    State,
    Plugins,
    Result
  > {
    const input: OptionInput<Name, Config> = {
      config: captureConfig(config),
      kind: 'option',
      name,
    };
    return this.derive(declareOption(this.#root, input));
  }

  globalOption<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      (Name extends keyof Options
        ? { 'This option name is already declared as a local option': Name }
        : unknown) &
      NoInfer<DefaultConstraint<Config>> &
      NoInfer<MultipleConstraint<Config>> &
      NoInfer<ValidateOmittedConstraint<Config>>,
  ): Application<
    Args,
    Options,
    Globals & Record<Name, OptionValue<Config>>,
    State,
    Plugins,
    Result
  > {
    const input: OptionInput<Name, Config> = {
      config: captureConfig(config),
      kind: 'option',
      name,
    };
    return new ApplicationBuilder<
      Args,
      Options,
      Globals & Record<Name, OptionValue<Config>>,
      State,
      Plugins,
      Result
    >(this.#name, recordGlobalOption(this.#root, name), {
      declared: this.#declared,
      globals: declareGlobalOption(this.#globals, input),
      options: this.#options,
      plugins: this.#plugins,
      views: this.#views,
    });
  }

  /** Registering the action closes input authoring; extension configuration remains available. */
  action(
    handler: Action<Args, Globals & Options, Result>,
  ): Application<Args, Options, Globals, AfterAction, Plugins, Result> {
    return this.derive(declareAction(this.#root, handler));
  }

  /** A child arrives in any type state, because its own action is the call that finished it. */
  command<const Child extends Command<unknown, unknown, Globals>>(
    child: Child & NoInfer<AttachmentConstraint<Globals, Child>>,
  ): Application<
    Args,
    Options,
    Globals,
    AfterCommand<Exclude<State, 'globalOption'>>,
    Plugins,
    Result
  > {
    return this.derive(attachChild(this.#root, child));
  }

  /**
   * The value the root action produces for its consumer. The type argument is stated by the
   * author, as it is on a Command.
   */
  result<Value>(declaration: {
    views: ResultViews<NoInfer<Value>>;
  }): Application<
    Args,
    Options,
    Globals,
    AfterResult<State>,
    Plugins,
    { kind: 'value'; value: Value }
  > {
    return this.derive<Args, Options, AfterResult<State>, { kind: 'value'; value: Value }>(
      declareResult(this.#root, 'value', declaration),
    );
  }

  /** The same declaration over a sequence, whose type argument is one row. */
  rows<Row>(declaration: {
    views: RowViews<NoInfer<Row>>;
  }): Application<Args, Options, Globals, AfterResult<State>, Plugins, { kind: 'rows'; row: Row }> {
    return this.derive<Args, Options, AfterResult<State>, { kind: 'rows'; row: Row }>(
      declareResult(this.#root, 'rows', declaration),
    );
  }

  /** Presentation after the fact, merged by key, as it is on a Command. */
  views(
    replacements: ResultViewsOf<Result>,
    options?: { default?: string },
  ): Application<Args, Options, Globals, State, Plugins, Result> {
    return this.derive(declareResultViews(this.#root, replacements, options));
  }

  extend(
    ...values: readonly ExtensionValue<'command'>[]
  ): Application<Args, Options, Globals, State, Plugins, Result> {
    return this.derive(declareExtensions(this.#root, values));
  }

  /**
   * Root declaration calls preserve the Application configuration. The next state
   * travels through this call: each method names its transition in its return type, and the
   * wrapper publishes the same runtime value in exactly that state.
   */
  private derive<DerivedArgs, DerivedOptions, Next extends ApplicationMethod, Declared = Result>(
    root: CommandState<DerivedArgs, DerivedOptions, Globals>,
  ): Application<DerivedArgs, DerivedOptions, Globals, Next, Plugins, Declared> {
    return new ApplicationBuilder<DerivedArgs, DerivedOptions, Globals, Next, Plugins, Declared>(
      this.#name,
      root,
      {
        declared: this.#declared,
        globals: this.#globals,
        options: this.#options,
        plugins: this.#plugins,
        views: this.#views,
      },
    );
  }

  /**
   * Every rule that reads the declarations alone, in the order `run()` reads them: the
   * application's own view overrides, the options slot, the installed list, each plugin's
   * declarations, then the whole Command graph. The application's overrides are read and published
   * first, because they need core's identities and nothing else, so every later declaration error
   * reaches them, while a fault in that list itself reports through core's own text. The merged
   * registry is published once the whole build has succeeded, so a build-time fault never resolves
   * through a plugin's overrides, which build has not yet validated.
   */
  private prepare(stage: PrepareStage): {
    facts: ApplicationFacts;
    graph: BuiltGraph;
    plugins: readonly BuiltPlugin[];
  } {
    const identities = viewIdentities(coreViews);
    const application = buildViews(
      { declares: false, sentence: 'The Application' },
      this.#views,
      identities,
    );
    stage.views([application]);
    stage.rendering(renderingPolicy(this.#declared.rendering));
    const facts = checkOptions(this.#options, this.#declared);
    const installed = installPlugins(this.#plugins ?? []);
    const install: PluginBuild = { descriptors: new Map(), extensions: new Map() };
    const plugins = buildPlugins(installed, install);
    stage.plugins(plugins);
    const contributors = plugins.map((entry) =>
      buildViews(
        { declares: true, sentence: pluginSentence(entry.identity) },
        entry.views,
        identities,
      ),
    );
    const graph = buildGraph(this.#root, this.#globals, { ...install, plugins });
    checkDeclarations([...graph.globals.inputs, ...collectInputs(graph.root)]);
    stage.views([application, ...contributors]);
    return { facts, graph, plugins };
  }

  /**
   * The built graph as plain, frozen data. It applies every rule `run()` applies without a schema,
   * in the order `run()` applies them, and throws `DeclarationError` when one fails. Validating a
   * declared default through its schema can be asynchronous, so that one rule stays in `run()`.
   * Nothing is cached: each call builds the graph anew.
   */
  inspect(): CommandGraph {
    const built = this.prepare({
      plugins: () => undefined,
      rendering: () => undefined,
      views: () => undefined,
    });
    return inspectGraph(this.#name, built.graph, built.facts);
  }

  async run(options?: RunOptions): Promise<ExitCode> {
    let stderr: Writable = process.stderr;
    let output: Output | undefined = undefined;
    let code: ExitCode = 0;
    let reportingFailed = false;
    // A registry that could not be built reports through core's defaults, not through itself.
    let registry: ViewRegistry | undefined = undefined;
    // Faults a plugin raised beside the primary outcome, reported after it and never before it.
    const faults: LoomError[] = [];
    // The failure this run reports as its primary outcome, so nothing reports it a second time.
    let primary: unknown = undefined;
    // One private controller per run, subscribed to the caller's signal at run entry.
    const controller = new AbortController();
    /**
     * The bracket this run holds. It exists once the caller's own signal has been read, so a
     * signal that is not an `AbortSignal` is reported through the failure path like any other.
     */
    let signals: SignalBracket | undefined = undefined;
    // A cancelled run resolves its cancellation code whenever it ends after graph build.
    // A declaration or internal failure raised before that ends the run with its own code instead.
    let graphBuilt = false;
    const cancellation = (): CancellationCode | undefined => {
      const reason = graphBuilt ? signals?.reason() : undefined;
      return reason ? cancellationCode(reason) : undefined;
    };
    /**
     * Every exit path of the run leaves through the removal below, the one place it is written,
     * so no listener this run installed outlives it however the run ends.
     */
    try {
      try {
        const overrides = options?.host;
        stderr = overrides?.stderr ?? stderr;
        const host = captureHost(overrides, stderr);
        const invocationOutput = new Output(host, controller.signal);
        output = invocationOutput;
        // The policy is read inside the build, after the application's own overrides are published.
        // A faulty rendering declaration then reports through the view the application listed.
        let policy: RenderingPolicy = {};
        signals = bracketRun(controller, checkSignal(options?.signal));
        const built = this.prepare({
          plugins: (plugins) => {
            invocationOutput.configure(
              policy,
              plugins.find((entry) => entry.theme !== undefined)?.theme ?? new Map(),
            );
          },
          rendering: (declared) => {
            policy = { ...declared, ...renderingPolicy(options?.rendering) };
            invocationOutput.configure(policy, new Map());
          },
          views: (value) => {
            registry = value;
            invocationOutput.useViews(value);
          },
        });
        const { graph } = built;
        const inputs = { globals: graph.globals.inputs, locals: collectInputs(graph.root) };
        const defaults = await prepareInputs(inputs, host);
        graphBuilt = true;
        if (!controller.signal.aborted) {
          /**
           * The listeners the validated signals owner claimed. A build failure installs none, and
           * neither does a run the caller had already cancelled: it touches the process not at all.
           */
          signals.install(ownedSignals(built.plugins));
          await runInvocation({
            channel: (binding) => invocationOutput.channel(binding),
            defaults,
            facts: built.facts,
            graph,
            host,
            name: this.#name,
            out: output.out,
            plugins: built.plugins,
            report: (fault) => faults.push(fault),
            route: (path) => {
              invocationOutput.useRoute(path);
            },
            signal: controller.signal,
            style: output.style,
          });
        }
        // The fault check covers the same window the write accounting covers.
        // A render failure an unawaited helper raised is still this invocation's failure.
        await output.settle();
        const fault = output.fault;
        if (fault) {
          // The action returned, so the view failure is this invocation's own failure.
          throw new InternalError(`Rendering output failed: ${reasonOf(fault.cause)}`, fault.cause);
        }
      } catch (error) {
        primary = error;
        try {
          const failure = toFailure(error);
          code = failure.exitCode;
          output ??= new Output(captureHost(undefined, stderr), controller.signal);
          const writes = await output.settle();
          if (writes.kind === 'ok' && !silenced(error, controller.signal, cancellation())) {
            const report = describeFailure(registry ?? noViews, failure, output.context('stderr'));
            if (report.kind === 'rendered') {
              // The view owns the trailing newline; output resolves its marked text.
              await output.report(report.text);
            } else {
              code = 1;
              // `report.text` is core's default text, which already ends in `\n`.
              await reportPlainly(
                stderr,
                `${report.text}Internal error: Rendering the failure failed: ${report.reason}\n`,
              );
            }
          }
        } catch {
          code = 1;
          reportingFailed = true;
        }
      }
      /**
       * A sequence that stopped on its own source reports the same way: the call the action never
       * awaited observed nothing, and a failure the action let propagate is the primary outcome
       * already, so the one it raised is not reported twice.
       */
      for (const cause of output?.stopped ?? []) {
        if (!carried(primary, cause)) {
          faults.push(toFailure(cause));
        }
      }
      // A plugin's own fault is reported after the primary outcome and turns a would-be 0 into 1.
      // The primary outcome keeps its code, the way a view failure leaves it alone.
      // It is reported the way the primary failure is, so an override answers its class.
      for (const fault of faults) {
        if (!silenced(fault, controller.signal, cancellation())) {
          code = code === 0 ? 1 : code;
          try {
            const report = describeFailure(registry ?? noViews, fault, output?.context('stderr'));
            if (report.kind === 'rendered') {
              await output?.report(report.text);
            } else {
              code = 1;
              await reportPlainly(
                stderr,
                `${report.text}Internal error: Rendering the failure failed: ${report.reason}\n`,
              );
            }
          } catch {
            reportingFailed = true;
          }
        }
      }
      if (output) {
        const writes = await output.settle();
        if (writes.kind === 'failed') {
          code = 1;
          reportingFailed = true;
        }
        output.dispose();
      }
      if (reportingFailed) {
        await reportPlainly(stderr, 'Internal error: Could not write invocation output.\n');
      }
      /**
       * One rule orders every code: a cancelled run resolves its signal's code, and a broken
       * failure view or destination in that run is reported as text without changing it. The
       * signal decides the code whatever the action did afterward, so this reading comes last.
       */
      code = cancellation() ?? code;
      process.exitCode = code;
      return code;
    } finally {
      signals?.finish();
    }
  }
}

/**
 * The authoring surface of an Application in one type state: the root Command's calls, `command()`,
 * `inspect()`, `run()`, and `name`. Every authoring call returns a new declaration value, leaves
 * its receiver unchanged, and publishes only the calls that are still valid after it. `inspect()`,
 * `run()`, and `name` survive every call. `State` lists the authoring calls a value still offers.
 * It defaults to the state after `action()`, which publishes the fewest calls, so
 * `Application<A, O, G>` accepts an application in any state, a finished one included.
 */
export type Application<
  Args = {},
  Options = {},
  Globals = {},
  State extends ApplicationMethod = AfterAction,
  Plugins extends readonly Plugin[] = readonly Plugin[],
  Result = unknown,
> = Pick<
  ApplicationBuilder<Args, Options, Globals, State, Plugins, Result>,
  | typeof applicationEnvironment
  | typeof declaredTypes
  | 'extend'
  | 'inspect'
  | 'name'
  | 'run'
  | State
  | ResultMethod<Result>
>;

interface ApplicationConstructor {
  new (name: string): Application<{}, {}, {}, ApplicationMethod, readonly []>;
  new <const Plugins extends readonly Plugin[] = readonly []>(
    name: string,
    options: ApplicationOptions<Plugins>,
  ): Application<{}, {}, {}, ApplicationMethod, Plugins>;
}

/** The core facts one Application declares, validated at build and reported by `inspect()`. */
interface ApplicationFacts {
  description: string | undefined;
  version: string;
}

/** The same facts as the constructor captured them, before any rule has read them. */
interface DeclaredFacts {
  rendering: unknown;
  description: unknown;
  version: unknown;
}

/** Reject obsolete wiring before silently losing options that invocations depend on. */
function checkOptions(options: unknown, declared: DeclaredFacts): ApplicationFacts {
  if (options !== undefined) {
    if (!isPlainObject(options)) {
      throw new DeclarationError(
        'The Application options must be an object. Supply an Application options object.',
      );
    }
    if ('globals' in options) {
      throw new DeclarationError(
        'The Application options contain globals. Declare them with globalOption(name, config).',
      );
    }
    if ('failures' in options) {
      throw new DeclarationError(
        'The Application options contain failures. Declare view overrides under views with override(key, view).',
      );
    }
    // The root is every page's entry point, so it carries neither listing fact.
    // A key that may not be there is a fault of the slot, so it answers with the slot's shape.
    checkNoListingFacts('The Application', options);
  }
  return {
    description: checkDescription('The Application', declared.description),
    version: checkVersion(declared.version),
  };
}

/** Constructor inference preserves the installed plugin tuple; globals start empty. */
class ApplicationDeclaration<
  const Plugins extends readonly Plugin[] = readonly [],
> extends ApplicationBuilder<{}, {}, {}, ApplicationMethod, Plugins> {
  constructor(name: string, options?: ApplicationOptions<Plugins>) {
    // The options slot is read defensively, never inspected: an invalid value still yields
    // `views` and the facts of some kind, and `checkOptions` reports it at build.
    // The root's own slot and core facts stay empty, because the Application checks its own slot.
    // Its diagnostics name the Application rather than the root Command.
    super(
      name,
      freshState({
        deprecated: undefined,
        description: undefined,
        extensions: options?.extensions,
        hidden: undefined,
        name: null,
        options: undefined,
      }),
      {
        declared: {
          description: options?.description,
          rendering: isPlainObject(options?.rendering)
            ? { ...options.rendering }
            : options?.rendering,
          version: options?.version,
        },
        globals: emptyGlobals(),
        options,
        plugins: options?.plugins,
        // An options slot that is no plain object carries no override list, and its own rule reports it.
        views: isPlainObject(options) ? options.views : undefined,
      },
    );
  }
}

export const Application: ApplicationConstructor = ApplicationDeclaration;
