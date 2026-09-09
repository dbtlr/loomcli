import type { Writable } from 'node:stream';

import {
  attachChild,
  buildGraph,
  collectInputs,
  declareAction,
  declareArgument,
  declareOption,
  freshState,
  selectCommand,
} from './command.js';
import type {
  AfterAction,
  AfterArgument,
  AfterCommand,
  Command,
  CommandMethod,
  CommandState,
} from './command.js';
import {
  buildFailures,
  DeclarationError,
  describeFailure,
  InternalError,
  reasonOf,
  toFailure,
} from './errors.js';
import type { FailureRegistry, FailureRenderer } from './errors.js';
import { checkDescription, checkVersion, isPlainObject } from './facts.js';
import { isGlobalOptions } from './globals.js';
import type { GlobalOptions } from './globals.js';
import { captureHost } from './host.js';
import { inspectGraph } from './inspect.js';
import type { CommandGraph } from './inspect.js';
import { Output, reportPlainly } from './output.js';
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
 * Everything an application configures beside its declarations: the options every Command shares,
 * and the renderers that answer the failure classes core throws.
 */
export interface ApplicationOptions<Globals = {}> {
  globals?: GlobalOptions<Globals>;
  failures?: readonly FailureRenderer[];
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
  // The constructor's raw options argument stays unexamined until build.
  // The options-slot rules answer at the same point every other authoring fault does:
  // `inspect()` and `run()`.
  readonly #options: unknown;

  constructor(
    name: string,
    root: CommandState<Args, Options, Globals>,
    config: { failures: readonly FailureRenderer[]; options?: unknown },
  ) {
    this.#failures = config.failures;
    this.#name = name;
    this.#options = config.options;
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
      failures: this.#failures,
      options: this.#options,
    });
  }

  /**
   * The built graph as plain, frozen data. It applies every rule `run()` applies without a schema,
   * in the order `run()` applies them, and throws `DeclarationError` when one fails. Validating a
   * declared default through its schema can be asynchronous, so that one rule stays in `run()`.
   * Nothing is cached: each call builds the graph anew.
   */
  inspect(): CommandGraph {
    const facts = checkOptions(this.#options);
    buildFailures(this.#failures);
    const graph = buildGraph(this.#root);
    checkDeclarations([...graph.globals.inputs, ...collectInputs(graph.root)]);
    return inspectGraph(this.#name, graph, facts);
  }

  async run(options?: RunOptions): Promise<ExitCode> {
    let stderr: Writable = process.stderr;
    let output: Output | undefined = undefined;
    let code: ExitCode = 0;
    let reportingFailed = false;
    // A registry that could not be built reports through core's defaults, not through itself.
    let registry: FailureRegistry | undefined = undefined;
    try {
      const overrides = options?.host;
      stderr = overrides?.stderr ?? stderr;
      const host = captureHost(overrides, stderr);
      output = new Output(host);
      checkOptions(this.#options);
      registry = buildFailures(this.#failures);
      const graph = buildGraph(this.#root);
      const inputs = { globals: graph.globals.inputs, locals: collectInputs(graph.root) };
      const defaults = await prepareInputs(inputs, host);
      const selected = await selectCommand(graph, { defaults, host });
      await selected.dispatch({
        host,
        out: output.out,
        passthrough: selected.passthrough,
        values: selected.values,
      });
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
        if (writes.kind === 'ok') {
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
    process.exitCode = code;
    return code;
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

/** The core facts one Application declares, read once per build and reported by `inspect()`. */
interface ApplicationFacts {
  description: string | undefined;
  version: string | undefined;
}

/**
 * The second argument, read where it is supplied. The retired positional form declares its globals
 * on a value that holds no `globals` key, so without this rule the globals vanish silently and the
 * operator, not the author, meets the consequence as an unknown-option error. The slot's own shape
 * settles first, because the facts it carries are read out of it.
 */
function checkOptions(options: unknown): ApplicationFacts {
  if (isGlobalOptions(options)) {
    throw new DeclarationError(
      'The Application takes an options object. Supply { globals } instead of a positional GlobalOptions value.',
    );
  }
  if (options !== undefined && !isPlainObject(options)) {
    throw new DeclarationError(
      'The Application options must be an object. Supply { globals, failures }.',
    );
  }
  const supplied = isPlainObject(options) ? options : {};
  return {
    description: checkDescription('The Application', supplied.description),
    version: checkVersion(supplied.version),
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
    // `globals` and `failures` of some kind, and `checkOptions` reports it at build instead.
    // The root's own slot stays empty, because the Application checks the slot it was handed.
    // Its diagnostics name the Application rather than the root Command.
    super(name, freshState(null, options?.globals, undefined), {
      failures: options?.failures ?? [],
      options,
    });
  }
}

/**
 * The public constructor takes a name and one options object. The globals type narrows to the
 * supplied value, and the failure renderers configure the application the way its commands do.
 */
export const Application: ApplicationConstructor = ApplicationDeclaration;
