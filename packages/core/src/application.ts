import type { Writable } from 'node:stream';

import { Command, route, validateInputs } from './command.js';
import { describeFailure } from './errors.js';
import { captureHost } from './host.js';
import { Output, reportOutputFailure } from './output.js';
import type {
  Action,
  NameConstraint,
  ExitCode,
  OptionConfig,
  OptionValue,
  RunOptions,
} from './types.js';

export interface Application<Args = {}, Options = {}> {
  argument<const Name extends string>(
    name: Name,
    config: { variadic: true; required: true } & NameConstraint<Name>,
  ): Application<Args & Record<Name, string[]>, Options>;
  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config & NameConstraint<Name>,
  ): Application<Args, Options & Record<Name, OptionValue<Config>>>;
  action(handler: Action<Args, Options>): this;
  run(options?: RunOptions): Promise<ExitCode>;
}

class ApplicationBuilder<Args, Options> implements Application<Args, Options> {
  constructor(
    readonly name: string,
    readonly root: Command<Args, Options>,
  ) {}

  argument<const Name extends string>(
    name: Name,
    _config: { variadic: true; required: true } & NameConstraint<Name>,
  ): Application<Args & Record<Name, string[]>, Options> {
    return new ApplicationBuilder(this.name, this.root.argument<Name>(name));
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config & NameConstraint<Name>,
  ): Application<Args, Options & Record<Name, OptionValue<Config>>> {
    return new ApplicationBuilder(this.name, this.root.option<Name, Config>(name, config));
  }

  action(handler: Action<Args, Options>): this {
    this.root.actions.push(handler);
    return this;
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
      const graph = { root: this.root.build() };
      const tokens = [...host.argv];
      const selected = route(graph.root, tokens);
      const inputs = validateInputs(selected.command, selected.tokens);
      await selected.command.action({ ...inputs, host, out: output.out });
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

export const Application: new (name: string) => Application = class extends ApplicationBuilder<
  {},
  {}
> {
  constructor(name: string) {
    super(
      name,
      new Command({
        actions: [],
        arguments: [],
        bind: () => ({}),
        bindOptions: () => ({}),
        options: [],
      }),
    );
  }
};
