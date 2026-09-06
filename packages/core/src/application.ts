import type { Writable } from 'node:stream';

import { Command, route, validateInputs } from './command.js';
import { describeFailure } from './errors.js';
import { captureHost } from './host.js';
import { Output, reportOutputFailure } from './output.js';
import type { Action, ExitCode, RunOptions } from './types.js';

export interface Application<Args = {}> {
  argument<const Name extends string>(
    name: Name,
    config: { variadic: true; required: true },
  ): Application<Args & Record<Name, string[]>>;
  action(handler: Action<Args>): this;
  run(options?: RunOptions): Promise<ExitCode>;
}

class ApplicationBuilder<Args> implements Application<Args> {
  constructor(
    readonly name: string,
    readonly root: Command<Args>,
  ) {}

  argument<const Name extends string>(
    name: Name,
    _config: { variadic: true; required: true },
  ): Application<Args & Record<Name, string[]>> {
    return new ApplicationBuilder(this.name, this.root.argument(name));
  }

  action(handler: Action<Args>): this {
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
      const args = validateInputs(selected.command, selected.tokens);
      await selected.command.action({ args, host, out: output.out });
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

export const Application: new (name: string) => Application = class extends ApplicationBuilder<{}> {
  constructor(name: string) {
    super(name, new Command([], [], () => ({})));
  }
};
