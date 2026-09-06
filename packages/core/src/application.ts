import type { Writable } from 'node:stream';

import {
  attachChild,
  CommandBuilder,
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
import { describeFailure } from './errors.js';
import type { GlobalOptions } from './globals.js';
import { captureHost } from './host.js';
import { Output, reportOutputFailure } from './output.js';
import type {
  Action,
  ArgumentConfig,
  ArgumentValue,
  declaredTypes,
  DeclaredTypes,
  DefaultConstraint,
  GlobalNameConstraint,
  NameConstraint,
  ExitCode,
  OptionConfig,
  OptionValue,
  RunOptions,
} from './types.js';
import type { ArgumentInput, OptionInput } from './validation.js';
import { prepareInputs } from './validation.js';

/**
 * Every authoring call an Application can publish, beside `run()` and `name`, which always remain.
 * An Application's type state is a subset of these, and each call removes the names it invalidates.
 */
export type ApplicationMethod = CommandMethod | 'command';

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

  constructor(name: string, root: CommandState<Args, Options, Globals>) {
    this.#name = name;
    this.#root = root;
  }

  get name(): string {
    return this.#name;
  }

  argument<const Name extends string, const Config extends ArgumentConfig>(
    name: Name,
    config: Config & NameConstraint<Name>,
  ): Application<
    Args & Record<Name, ArgumentValue<Config>>,
    Options,
    Globals,
    AfterArgument<State>
  > {
    const input: ArgumentInput<Name, ArgumentValue<Config>> = {
      config: { ...config },
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
      NoInfer<DefaultConstraint<Config>>,
  ): Application<Args, Options & Record<Name, OptionValue<Config>>, Globals, State> {
    const input: OptionInput<Name, OptionValue<Config>> = {
      config: { ...config },
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
    return new ApplicationBuilder(this.#name, root);
  }

  async run(options?: RunOptions): Promise<ExitCode> {
    let stderr: Writable = process.stderr;
    let output: Output | undefined = undefined;
    let code: ExitCode = 0;
    let reportingFailed = false;
    try {
      const overrides = options?.host;
      stderr = overrides?.stderr ?? stderr;
      const host = captureHost(overrides, stderr);
      output = new Output(host);
      // The root builds like any Command, so the graph starts from a builder over its state.
      const graph = new CommandBuilder(this.#root).buildGraph();
      const defaults = await prepareInputs([...graph.globals.inputs, ...collectInputs(graph.root)]);
      const selected = await selectCommand(graph, [...host.argv], defaults);
      await selected.command.dispatch({
        host,
        out: output.out,
        passthrough: selected.passthrough,
        values: selected.values,
      });
    } catch (error) {
      try {
        const failure = describeFailure(error);
        code = failure.code;
        output ??= new Output({ stderr, stdout: process.stdout });
        const writes = await output.settle();
        if (writes.kind === 'ok') {
          await output.emit(failure.kind, failure.message);
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
      await reportOutputFailure(stderr);
    }
    process.exitCode = code;
    return code;
  }
}

/**
 * The authoring surface of an Application in one type state: the root Command's calls, `command()`,
 * `run()`, and `name`. Every authoring call returns a new declaration value, leaves its receiver
 * unchanged, and publishes only the calls that are still valid after it. `run()` and `name` survive
 * every call. `State` lists the authoring calls a value still offers. It defaults to the state
 * after `action()`, which publishes the fewest calls, so `Application<A, O, G>` accepts an
 * application in any state, a finished one included.
 */
export type Application<
  Args = {},
  Options = {},
  Globals = {},
  State extends ApplicationMethod = AfterAction,
> = Pick<
  ApplicationBuilder<Args, Options, Globals, State>,
  typeof declaredTypes | 'name' | 'run' | State
>;

interface ApplicationConstructor {
  new (name: string): Application<{}, {}, {}, ApplicationMethod>;
  new <Globals>(
    name: string,
    globals: GlobalOptions<Globals>,
  ): Application<{}, {}, Globals, ApplicationMethod>;
}

/**
 * The runtime class behind the public constructor. `Globals` defaults to `{}`, so the name-only
 * constructor signature instantiates it without a cast, and the globals signature infers it from
 * the supplied value.
 */
class ApplicationDeclaration<Globals = {}> extends ApplicationBuilder<{}, {}, Globals> {
  constructor(name: string, globals?: GlobalOptions<Globals>) {
    super(name, freshState(null, globals));
  }
}

/** The public constructor takes a name and narrows the globals type to the supplied value. */
export const Application: ApplicationConstructor = ApplicationDeclaration;
