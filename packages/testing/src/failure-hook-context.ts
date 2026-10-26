/**
 * The context a test calls one `onFailure` hook with. A hook takes the failure and its context, so
 * the builder returns the context, the second argument, and the test constructs the failure.
 */
import type { FailureHook, FailureHookContext } from '@loomcli/core';

import { logWith, unstated } from './unstated-members.js';
import type { OptionalMembers } from './unstated-members.js';
import { unstatedStyle } from './unstated-style.js';

/**
 * What a test states to build a failure hook context: the facts the failure view reads, each
 * whole, and any other member it means the hook to read.
 */
type FailureHookValues = Pick<
  FailureHookContext,
  'application' | 'path' | 'invokedBy' | 'view' | 'mediaType'
> &
  OptionalMembers<Pick<FailureHookContext, 'style' | 'log' | 'graph' | 'command'>>;

/**
 * Builds the context an `onFailure` hook takes second from the values the test states.
 *
 * ```ts
 * const context = failureHookContext(hints, {
 *   application: 'notes',
 *   invokedBy: 'argv',
 *   mediaType: undefined,
 *   path: [],
 *   view: undefined,
 * });
 * hints(new UnknownCommandError('lsit', ['list']), context);
 * ```
 */
function failureHookContext(hook: FailureHook, values: FailureHookValues): FailureHookContext {
  return {
    ...values,
    get command() {
      return values.command ?? unstated('failureHookContext', 'command');
    },
    get graph() {
      return values.graph ?? unstated('failureHookContext', 'graph');
    },
    log: logWith(values.log),
    style: values.style ?? unstatedStyle(),
  };
}

export { failureHookContext };
export type { FailureHookValues };
