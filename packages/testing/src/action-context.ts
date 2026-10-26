/**
 * The context a test calls one extracted action handler with, typed from the handler alone. The
 * test states the handler's inputs whole, and every other member is optional.
 */
import type { Action, ActionContext, StdinContext } from '@loomcli/core';

import {
  logWith,
  neverAborts,
  nothing,
  outWith,
  registersNothing,
  unstated,
  unstatedInvoke,
} from './unstated-members.js';
import type { OptionalMembers } from './unstated-members.js';
import { unstatedStyle } from './unstated-style.js';

/**
 * What a test states to build an action context: `args`, `options`, and `provided` whole, `stdin`
 * as the handler's context types it, and any other member it means the handler to read.
 */
type ActionValues<Args, Options, Result, Stdin extends StdinContext, Provided> = Pick<
  ActionContext<Args, Options, Result, Provided>,
  'args' | 'options' | 'provided'
> &
  Stdin &
  OptionalMembers<
    Omit<ActionContext<Args, Options, Result, Provided>, 'args' | 'options' | 'provided' | 'stdin'>
  >;

/**
 * Builds the context an extracted action handler takes, typed `ActionHandler<typeof declaration>`,
 * from the values the test states. The builder never calls the handler; the test does.
 *
 * ```ts
 * const context = actionContext(getValue, {
 *   args: { path: 'name' },
 *   options: { verbose: 0 },
 *   out: { print },
 *   provided: {},
 * });
 * await getValue(context);
 * ```
 */
function actionContext<Args, Options, Result, Stdin extends StdinContext, Provided>(
  handler: Action<Args, Options, Result, Stdin, Provided>,
  values: NoInfer<ActionValues<Args, Options, Result, Stdin, Provided>>,
): Omit<ActionContext<Args, Options, Result, Provided>, 'stdin'> & Stdin {
  // The context types host and passthrough as assignable, so an assignment replaces the stated one.
  let { host, passthrough } = values;
  return {
    ...values,
    cancel: values.cancel ?? nothing,
    get command() {
      return values.command ?? unstated('actionContext', 'command');
    },
    get graph() {
      return values.graph ?? unstated('actionContext', 'graph');
    },
    get host() {
      return host ?? unstated('actionContext', 'host');
    },
    set host(value) {
      host = value;
    },
    get interactive() {
      return values.interactive ?? unstated('actionContext', 'interactive');
    },
    invoke: values.invoke ?? unstatedInvoke,
    log: logWith(values.log),
    onResume: values.onResume ?? registersNothing,
    onShutdown: values.onShutdown ?? registersNothing,
    onSuspend: values.onSuspend ?? registersNothing,
    out: outWith(values.out),
    get passthrough() {
      return passthrough ?? unstated('actionContext', 'passthrough');
    },
    set passthrough(value) {
      passthrough = value;
    },
    signal: values.signal ?? neverAborts(),
    style: values.style ?? unstatedStyle(),
    get supplied() {
      return values.supplied ?? unstated('actionContext', 'supplied');
    },
  };
}

export { actionContext };
export type { ActionValues };
