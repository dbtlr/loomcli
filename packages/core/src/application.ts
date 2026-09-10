import type { Writable } from 'node:stream';

import { runInvocation } from './chain.js';
import {
  attachChild,
  buildGraph,
  collectInputs,
  declareAction,
  declareArgument,
  declareOption,
  freshState,
} from './command.js';
import type {
  AfterAction,
  AfterArgument,
  AfterCommand,
  BuiltGraph,
  Command,
  CommandMethod,
  CommandState,
} from './command.js';
import {
  buildFailures,
  DeclarationError,
  describeFailure,
  InternalError,
  mergeFailures,
  reasonOf,
  toFailure,
} from './errors.js';
import type { FailureRegistry, FailureRenderer, LoomError } from './errors.js';
import type { ExtensionValue } from './extension.js';
import { checkDescription, checkNoListingFacts, checkVersion, isPlainObject } from './facts.js';
import { isGlobalOptions } from './globals.js';
import type { GlobalOptions } from './globals.js';
import { captureHost } from './host.js';
import { inspectGraph } from './inspect.js';
import type { CommandGraph } from './inspect.js';
import { Output, reportPlainly } from './output.js';
import { buildPlugins, installPlugins, ownedSignals, pluginSentence } from './plugin.js';
import type { BuiltPlugin, Plugin, PluginBuild } from './plugin.js';
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
  RunOptions,
  ValidateOmittedConstraint,
} from './types.js';
import type { ArgumentInput, OptionInput } from './validation.js';
import { captureConfig, checkDeclarations, prepareInputs } from './validation.js';

/**
 * Every authoring call an Application can publish, beside `run()` and `name`, which always remain.
 * An Application's type state is a subset of these, and each call removes the names it invalidates.
 * The unnamed root declares what a named Command declares, except for `alias()`: the root answers
 * to no bare token, so it has no name to alias.
 */
export type ApplicationMethod = Exclude<CommandMethod, 'alias'>;

/** The registry a failure is reported through when the application's own could not be built. */
const noRegistrations: FailureRegistry = new Map();

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

/**
 * Everything an application configures beside its declarations: the options every Command shares,
 * and the renderers that answer the failure classes core throws.
 */
export interface ApplicationOptions<Globals = {}> {
  globals?: GlobalOptions<Globals>;
  failures?: readonly FailureRenderer[];
  plugins?: readonly Plugin[];
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
> {
  declare readonly [declaredTypes]: DeclaredTypes<Args, Options, Globals>;

  readonly #name: string;
  readonly #root: CommandState<Args, Options, Globals>;
  readonly #failures: readonly FailureRenderer[];
  readonly #plugins: readonly Plugin[];
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
      failures: readonly FailureRenderer[];
      options?: unknown;
      plugins: readonly Plugin[];
    },
  ) {
    this.#declared = config.declared;
    this.#failures = config.failures;
    this.#name = name;
    this.#options = config.options;
    this.#plugins = config.plugins;
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
    AfterArgument<State>
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
  ): Application<Args, Options & Record<Name, OptionValue<Config>>, Globals, State> {
    const input: OptionInput<Name, Config> = {
      config: captureConfig(config),
      kind: 'option',
      name,
    };
    return this.derive(declareOption(this.#root, input));
  }

  /** The action is the last call, so it returns `AfterAction`: only `run()` and `name` remain. */
  action(handler: Action<Args, Globals & Options>): Application<Args, Options, Globals> {
    return this.derive(declareAction(this.#root, handler));
  }

  /** A child arrives in any type state, because its own action is the call that finished it. */
  command(
    child: Command<unknown, unknown, Globals>,
  ): Application<Args, Options, Globals, AfterCommand<State>> {
    return this.derive(attachChild(this.#root, child));
  }

  /**
   * One wrapper for every declaration call, so the Application keeps its name. The next state
   * travels through this call: each method names its transition in its return type, and the
   * wrapper publishes the same runtime value in exactly that state.
   */
  private derive<DerivedArgs, DerivedOptions, Next extends ApplicationMethod>(
    root: CommandState<DerivedArgs, DerivedOptions, Globals>,
  ): Application<DerivedArgs, DerivedOptions, Globals, Next> {
    return new ApplicationBuilder(this.#name, root, {
      declared: this.#declared,
      failures: this.#failures,
      options: this.#options,
      plugins: this.#plugins,
    });
  }

  /**
   * Every rule that reads the declarations alone, in the order `run()` reads them: the options
   * slot, the installed list, the application's failure registrations, each plugin's declarations,
   * then the whole Command graph. The registry is published as soon as it is known, so a later
   * declaration error still reaches the renderers the application registered for it.
   */
  private prepare(register: (registry: FailureRegistry) => void): {
    facts: ApplicationFacts;
    graph: BuiltGraph;
    plugins: readonly BuiltPlugin[];
  } {
    const facts = checkOptions(this.#options, this.#declared);
    const installed = installPlugins(this.#plugins);
    const application = buildFailures(this.#failures);
    register(application);
    const install: PluginBuild = { descriptors: new Map(), extensions: new Map() };
    const plugins = buildPlugins(installed, install);
    register(
      mergeFailures([
        application,
        ...plugins.map((entry) => buildFailures(entry.failures, pluginSentence(entry.identity))),
      ]),
    );
    const graph = buildGraph(this.#root, { ...install, plugins });
    checkDeclarations([...graph.globals.inputs, ...collectInputs(graph.root)]);
    return { facts, graph, plugins };
  }

  /**
   * The built graph as plain, frozen data. It applies every rule `run()` applies without a schema,
   * in the order `run()` applies them, and throws `DeclarationError` when one fails. Validating a
   * declared default through its schema can be asynchronous, so that one rule stays in `run()`.
   * Nothing is cached: each call builds the graph anew.
   */
  inspect(): CommandGraph {
    const built = this.prepare(() => undefined);
    return inspectGraph(this.#name, built.graph, built.facts);
  }

  async run(options?: RunOptions): Promise<ExitCode> {
    let stderr: Writable = process.stderr;
    let output: Output | undefined = undefined;
    let code: ExitCode = 0;
    let reportingFailed = false;
    // A registry that could not be built reports through core's defaults, not through itself.
    let registry: FailureRegistry | undefined = undefined;
    // Faults a plugin raised beside the primary outcome, reported after it and never before it.
    const faults: LoomError[] = [];
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
        output = new Output(host);
        signals = bracketRun(controller, checkSignal(options?.signal));
        const built = this.prepare((value) => {
          registry = value;
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
            defaults,
            facts: built.facts,
            graph,
            host,
            name: this.#name,
            out: output.out,
            plugins: built.plugins,
            report: (fault) => faults.push(fault),
            signal: controller.signal,
          });
        }
        // The fault check covers the same window the write accounting covers.
        // A render failure an unawaited helper raised is still this invocation's failure.
        await output.settle();
        const fault = output.fault;
        if (fault) {
          // The action returned, so the renderer failure is this invocation's own failure.
          throw new InternalError(`Rendering output failed: ${reasonOf(fault.cause)}`, fault.cause);
        }
      } catch (error) {
        try {
          const failure = toFailure(error);
          code = failure.exitCode;
          output ??= new Output({ stderr, stdout: process.stdout });
          const writes = await output.settle();
          if (writes.kind === 'ok' && !silenced(error, controller.signal, cancellation())) {
            const report = describeFailure(registry ?? noRegistrations, failure);
            if (report.kind === 'rendered') {
              // The renderer already owns every byte, trailing newline included: pass it through.
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
      // A plugin's own fault is reported after the primary outcome and turns a would-be 0 into 1.
      // The primary outcome keeps its code, the way a renderer failure leaves it alone.
      // It is reported the way the primary failure is, so a registered renderer answers its class.
      for (const fault of faults) {
        if (!silenced(fault, controller.signal, cancellation())) {
          code = code === 0 ? 1 : code;
          try {
            const report = describeFailure(registry ?? noRegistrations, fault);
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
       * failure renderer or destination in that run is reported as text without changing it. The
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
> = Pick<
  ApplicationBuilder<Args, Options, Globals, State>,
  typeof declaredTypes | 'inspect' | 'name' | 'run' | State
>;

interface ApplicationConstructor {
  new (name: string): Application<{}, {}, {}, ApplicationMethod>;
  new <Globals = {}>(
    name: string,
    options: ApplicationOptions<Globals>,
  ): Application<{}, {}, Globals, ApplicationMethod>;
}

/** The core facts one Application declares, validated at build and reported by `inspect()`. */
interface ApplicationFacts {
  description: string | undefined;
  version: string;
}

/** The same facts as the constructor captured them, before any rule has read them. */
interface DeclaredFacts {
  description: unknown;
  version: unknown;
}

/**
 * The second argument, read where it is supplied. The retired positional form declares its globals
 * on a value that holds no `globals` key, so without this rule the globals vanish silently and the
 * operator, not the author, meets the consequence as an unknown-option error. The slot's own shape
 * settles first, because a slot that is not an options object carries no facts to report.
 */
function checkOptions(options: unknown, declared: DeclaredFacts): ApplicationFacts {
  if (isGlobalOptions(options)) {
    throw new DeclarationError(
      'The Application takes an options object. Supply { globals } instead of a positional GlobalOptions value.',
    );
  }
  if (options !== undefined) {
    if (!isPlainObject(options)) {
      throw new DeclarationError(
        'The Application options must be an object. Supply { globals, failures }.',
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

/**
 * The runtime class behind the public constructor. It is generic so that an instance's `Globals`
 * is the type of the value it holds, with `{}` standing in when there is none, which is what each
 * signature of the constructor interface publishes.
 */
class ApplicationDeclaration<Globals = {}> extends ApplicationBuilder<{}, {}, Globals> {
  constructor(name: string, options?: ApplicationOptions<Globals>) {
    // The options slot is read defensively, never inspected: an invalid value still yields
    // `globals`, `failures`, and the facts of some kind, and `checkOptions` reports it at build.
    // The root's own slot and core facts stay empty, because the Application checks its own slot.
    // Its diagnostics name the Application rather than the root Command.
    super(
      name,
      freshState({
        deprecated: undefined,
        description: undefined,
        extensions: options?.extensions,
        globals: options?.globals,
        hidden: undefined,
        name: null,
        options: undefined,
      }),
      {
        declared: { description: options?.description, version: options?.version },
        failures: options?.failures ?? [],
        options,
        plugins: options?.plugins ?? [],
      },
    );
  }
}

/**
 * The public constructor takes a name and one options object. The globals type narrows to the
 * supplied value, and the failure renderers configure the application the way its commands do.
 */
export const Application: ApplicationConstructor = ApplicationDeclaration;
