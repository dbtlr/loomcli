import type { Writable } from 'node:stream';

import { CommandBuilder, collectInputs, selectCommand } from './command.js';
import type { Command, CommandMethod } from './command.js';
import { describeFailure } from './errors.js';
import type { GlobalOptions } from './globals.js';
import { defaultGlobals } from './globals.js';
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
import { prepareInputs } from './validation.js';

/**
 * Every authoring call an Application can publish, beside `run()` and `name`, which always remain.
 * An Application's type state is a subset of these, and each call removes the names it invalidates.
 */
type ApplicationMethod = CommandMethod | 'command';

class ApplicationBuilder<
  Args,
  Options,
  Globals,
  State extends ApplicationMethod = ApplicationMethod,
> {
  declare readonly [declaredTypes]: DeclaredTypes<Args, Options, Globals>;

  readonly #name: string;
  readonly #root: CommandBuilder<Args, Options, Globals>;

  constructor(name: string, root: CommandBuilder<Args, Options, Globals>) {
    this.#name = name;
    this.#root = root;
  }

  get name(): string {
    return this.#name;
  }

  /** Each call delegates to the root Command declaration and wraps the value it returns. */
  argument<const Name extends string, const Config extends ArgumentConfig>(
    name: Name,
    config: Config & NameConstraint<Name>,
  ): Application<
    Args & Record<Name, ArgumentValue<Config>>,
    Options,
    Globals,
    Exclude<State, 'command'>
  > {
    return this.derive(this.#root.argument<Name, Config>(name, config));
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      GlobalNameConstraint<Name, Globals> &
      NoInfer<DefaultConstraint<Config>>,
  ): Application<Args, Options & Record<Name, OptionValue<Config>>, Globals, State> {
    return this.derive(this.#root.option<Name, Config>(name, config));
  }

  /** The action is the last declaration call; only `run()` and `name` remain after it. */
  action(handler: Action<Args, Globals & Options>): Application<Args, Options, Globals, never> {
    return this.derive(this.#root.action(handler));
  }

  /** A child arrives in any type state, because its own action is the call that finished it. */
  command(
    child: Command<unknown, unknown, Globals, never>,
  ): Application<Args, Options, Globals, Exclude<State, 'argument'>> {
    return this.derive(this.#root.attach(child));
  }

  /** One wrapper for every declaration call, so the Application keeps its name and its root. */
  private derive<DerivedArgs, DerivedOptions>(
    root: Command<DerivedArgs, DerivedOptions, Globals, never>,
  ): ApplicationBuilder<DerivedArgs, DerivedOptions, Globals> {
    // A declaration call always returns a CommandBuilder; the public type only hides its state.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const derived = root as CommandBuilder<DerivedArgs, DerivedOptions, Globals>;
    return new ApplicationBuilder(this.#name, derived);
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
      const graph = this.#root.buildGraph();
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
 * every call, so `Application<A, O, G, never>` is the finished application and can still run.
 */
export type Application<
  Args = {},
  Options = {},
  Globals = {},
  State extends ApplicationMethod = ApplicationMethod,
> = Pick<
  ApplicationBuilder<Args, Options, Globals, State>,
  typeof declaredTypes | 'name' | 'run' | State
>;

interface ApplicationConstructor {
  new (name: string): Application;
  new <Globals>(name: string, globals: GlobalOptions<Globals>): Application<{}, {}, Globals>;
}

class ApplicationDeclaration extends ApplicationBuilder<{}, {}, {}> {
  constructor(name: string, globals?: GlobalOptions) {
    super(
      name,
      new CommandBuilder({
        actions: [],
        bind: () => ({ args: {}, options: {} }),
        children: [],
        globals: defaultGlobals(globals),
        inputs: [],
        late: [],
        name: null,
      }),
    );
  }
}

/** The public constructor takes a name and narrows the globals type to the supplied value. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const Application = ApplicationDeclaration as unknown as ApplicationConstructor;
