/**
 * The context a test calls one middleware with. The test imports the middleware's module itself, so
 * no loader runs and no activation is checked.
 */
import type { ExitCode, MiddlewareContext, PluginOptions, ResultTransform } from '@loomcli/core';

import {
  logWith,
  neverAborts,
  outWith,
  registersNothing,
  unstated,
  unstatedNext,
} from './unstated-members.js';
import type { OptionalMembers } from './unstated-members.js';

/** The inputs a middleware reads, each stated whole. */
type MiddlewareInputs = 'options' | 'ownOptions' | 'spellings' | 'request' | 'view';

/**
 * What a test states to build a middleware context: `options`, `ownOptions`, `spellings`, `request`,
 * and `view` whole, and any other member it means the middleware to read.
 *
 * @public
 */
type MiddlewareValues<Options extends PluginOptions> = Pick<
  MiddlewareContext<Options>,
  MiddlewareInputs
> &
  OptionalMembers<Omit<MiddlewareContext<Options>, MiddlewareInputs>>;

/**
 * Builds the context a middleware takes from the values the test states. The context keeps the
 * last view, the last media type, and the last result transform the middleware assigns, so a test
 * reads `context.view`, `context.mediaType`, and `context.transform` after the call; no check runs
 * on any of them, because no dispatch boundary follows. An unstated `mediaType` reads `undefined`,
 * and nothing derives it from `view`. An unstated `transform` reads `undefined`. The context also
 * keeps the last exit code the middleware states, which an unstated `exitCode` starts as
 * `undefined`. An unstated `unknownCommand` reads `null` and an unstated `invokedBy` reads `'argv'`,
 * a routed run on a command line.
 *
 * @example
 * ```ts
 * import { middlewareContext } from '@loomcli/testing';
 * import { vi } from 'vitest';
 *
 * import { middleware } from './dry-run.js';
 *
 * const next = vi.fn();
 * const context = middlewareContext(middleware, {
 *   next,
 *   options: { dryRun: true },
 *   ownOptions: { dryRun: true },
 *   request: { args: {}, options: {}, passthrough: [] },
 *   spellings: { dryRun: '--dry-run' },
 *   view: null,
 * });
 * await middleware(context);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/testing.md#middlewarecontext
 * @public
 */
function middlewareContext<Options extends PluginOptions>(
  middleware: (context: MiddlewareContext<Options>) => Promise<void> | void,
  values: MiddlewareValues<Options>,
): MiddlewareContext<Options> {
  let { exitCode, mediaType, transform, view } = values;
  return {
    ...values,
    get command() {
      return values.command ?? unstated('middlewareContext', 'command');
    },
    get exitCode(): ExitCode | undefined {
      return exitCode;
    },
    set exitCode(code: ExitCode) {
      exitCode = code;
    },
    get graph() {
      return values.graph ?? unstated('middlewareContext', 'graph');
    },
    get host() {
      return values.host ?? unstated('middlewareContext', 'host');
    },
    invokedBy: values.invokedBy ?? 'argv',
    log: logWith(values.log),
    get mediaType(): string | undefined {
      return mediaType;
    },
    set mediaType(type: string) {
      mediaType = type;
    },
    next: values.next ?? unstatedNext,
    onResume: values.onResume ?? registersNothing,
    onShutdown: values.onShutdown ?? registersNothing,
    onSuspend: values.onSuspend ?? registersNothing,
    out: outWith(values.out, 'middlewareContext'),
    signal: values.signal ?? neverAborts(),
    get transform(): ResultTransform | undefined {
      return transform;
    },
    set transform(next: ResultTransform) {
      transform = next;
    },
    // The contract reads a routed run's unknown command as null, as core hands it.
    // oxlint-disable-next-line unicorn/no-null
    unknownCommand: values.unknownCommand ?? null,
    get view(): string | null {
      return view;
    },
    set view(name: string) {
      view = name;
    },
  };
}

export { middlewareContext };
export type { MiddlewareValues };
