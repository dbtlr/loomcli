import type { Writable } from 'node:stream';

import { CommandBuilder, collectInputs, selectCommand } from './command.js';
import type { Command } from './command.js';
import { describeFailure } from './errors.js';
import type { GlobalOptions } from './globals.js';
import { defaultGlobals } from './globals.js';
import { captureHost } from './host.js';
import { Output, reportOutputFailure } from './output.js';
import type {
  Action,
  ArgumentConfig,
  ArgumentValue,
  DefaultConstraint,
  GlobalNameConstraint,
  NameConstraint,
  ExitCode,
  OptionConfig,
  OptionValue,
  RunOptions,
} from './types.js';
import { prepareInputs } from './validation.js';

class ApplicationBuilder<Args, Options, Globals> {
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
  ): Application<Args & Record<Name, ArgumentValue<Config>>, Options, Globals> {
    return this.derive(this.#root.argument<Name, Config>(name, config));
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      GlobalNameConstraint<Name, Globals> &
      NoInfer<DefaultConstraint<Config>>,
  ): Application<Args, Options & Record<Name, OptionValue<Config>>, Globals> {
    return this.derive(this.#root.option<Name, Config>(name, config));
  }

  action(handler: Action<Args, Globals & Options>): Application<Args, Options, Globals> {
    return this.derive(this.#root.action(handler));
  }

  command<ChildArgs, ChildOptions>(
    child: Command<ChildArgs, ChildOptions, Globals>,
  ): Application<Args, Options, Globals> {
    return this.derive(this.#root.attach(child));
  }

  /** One wrapper for every declaration call, so the Application keeps its name and its root. */
  private derive<DerivedArgs, DerivedOptions>(
    root: Command<DerivedArgs, DerivedOptions, Globals>,
  ): Application<DerivedArgs, DerivedOptions, Globals> {
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
 * The authoring surface of an Application: the root Command's calls, `command()`, and `run()`.
 * Every authoring call returns a new declaration value and leaves its receiver unchanged.
 */
export type Application<Args = {}, Options = {}, Globals = {}> = Pick<
  ApplicationBuilder<Args, Options, Globals>,
  'action' | 'argument' | 'command' | 'name' | 'option' | 'run'
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
        name: null,
      }),
    );
  }
}

/** The public constructor takes a name and narrows the globals type to the supplied value. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const Application = ApplicationDeclaration as unknown as ApplicationConstructor;
