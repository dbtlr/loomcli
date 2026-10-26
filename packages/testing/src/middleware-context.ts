/**
 * The context a test calls one middleware with. The test imports the middleware's module itself, so
 * no loader runs and no activation is checked.
 */
import type { MiddlewareContext, PluginOptions } from '@loomcli/core';

import { logWith, neverAborts, outWith, registers, unstated } from './unstated-members.js';
import type { OptionalMembers } from './unstated-members.js';

/** The inputs a middleware reads, each stated whole. */
type MiddlewareInputs = 'options' | 'ownOptions' | 'spellings' | 'request' | 'view';

/**
 * What a test states to build a middleware context: `options`, `ownOptions`, `spellings`, `request`,
 * and `view` whole, and any other member it means the middleware to read.
 */
type MiddlewareValues<Options extends PluginOptions> = Pick<
  MiddlewareContext<Options>,
  MiddlewareInputs
> &
  OptionalMembers<Omit<MiddlewareContext<Options>, MiddlewareInputs>>;

/**
 * Builds the context a middleware takes from the values the test states. The context keeps the
 * last view the middleware assigns, so a test reads `context.view` after the call; no check runs on
 * it, because no dispatch boundary follows.
 *
 * ```ts
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
 */
function middlewareContext<Options extends PluginOptions>(
  middleware: (context: MiddlewareContext<Options>) => Promise<void> | void,
  values: MiddlewareValues<Options>,
): MiddlewareContext<Options> {
  let { view } = values;
  return {
    ...values,
    get command() {
      return values.command ?? unstated('middlewareContext', 'command');
    },
    get graph() {
      return values.graph ?? unstated('middlewareContext', 'graph');
    },
    get host() {
      return values.host ?? unstated('middlewareContext', 'host');
    },
    log: logWith(values.log),
    next:
      values.next ??
      (() =>
        Promise.reject(
          new Error(
            "middlewareContext has no next for this middleware to call. Add next to its values, such as next: async () => 'dispatched'.",
          ),
        )),
    onResume: values.onResume ?? registers,
    onShutdown: values.onShutdown ?? registers,
    onSuspend: values.onSuspend ?? registers,
    out: outWith(values.out),
    signal: values.signal ?? neverAborts(),
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
