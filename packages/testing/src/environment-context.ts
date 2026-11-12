/**
 * The context a test calls one `onEnvironment` hook with. The hook runs before any input is
 * parsed, so the context holds only the host, `log`, and `out.warn`.
 */
import type { EnvironmentContext, EnvironmentHook } from '@loomcli/core';

import { logWith, resolved, unstated } from './unstated-members.js';

/**
 * What a test states to build an environment hook's context: each `host` member, and `log` and
 * `out`, member by member, that it means the hook to read.
 *
 * @public
 */
interface EnvironmentValues {
  /** The host members the hook reads; an unstated one throws its sentence when read. */
  readonly host?: Partial<EnvironmentContext['host']>;
  /** The log levels the test observes; an unstated level does nothing. */
  readonly log?: Partial<EnvironmentContext['log']>;
  /** The `warn` the test observes; an unstated `warn` resolves and writes nothing. */
  readonly out?: Partial<EnvironmentContext['out']>;
}

/**
 * Builds the context an `onEnvironment` hook takes from the values the test states. An unstated
 * `host.cwd` or `host.env` throws its sentence when the hook reads it.
 *
 * ```ts
 * const context = environmentContext(regionDefault, { host: { env: {} } });
 * expect(await regionDefault(context)).toEqual({ REGION: 'us-east-1' });
 * ```
 *
 * @public
 */
function environmentContext(hook: EnvironmentHook, values: EnvironmentValues): EnvironmentContext {
  const host = values.host ?? {};
  return {
    host: {
      get cwd() {
        return host.cwd ?? unstated('environmentContext', 'host.cwd');
      },
      get env() {
        return host.env ?? unstated('environmentContext', 'host.env');
      },
    },
    log: logWith(values.log),
    out: { warn: resolved, ...values.out },
  };
}

export { environmentContext };
export type { EnvironmentValues };
