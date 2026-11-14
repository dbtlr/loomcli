import type { Host } from '../host/types.js';
import type { Log, LogBinder } from '../output/log.js';
import type { Out } from '../output/types.js';
import type { BuiltPlugin } from './plugin.js';

/**
 * Environment preparation precedes input validation and exposes no parsed invocation.
 *
 * @public
 * @sealed
 */
interface EnvironmentContext {
  /**
   * The host's working directory and a read-only snapshot of its environment, including the
   * additions earlier hooks made.
   */
  readonly host: {
    readonly cwd: Host['cwd'];
    readonly env: Readonly<Host['env']>;
  };
  /** The output channel, which a hook uses to warn the operator. */
  readonly out: Pick<Out, 'warn'>;
  /** Records a log event under the identity of the plugin whose hook is running. */
  readonly log: Log;
}

/**
 * A plugin's `onEnvironment` hook: it returns the environment variables to add before any input is
 * validated, or nothing. A variable the environment already defines, an empty one included, keeps
 * its value.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/plugin-contract.md#environment-preparation
 * @public
 */
type EnvironmentHook = (
  context: EnvironmentContext,
) => Readonly<Record<string, string>> | void | Promise<Readonly<Record<string, string>> | void>;

interface EnvironmentSetup {
  host: Host;
  log: LogBinder;
  out: Pick<Out, 'warn'>;
  plugins: readonly BuiltPlugin[];
  /** Where an argv run copies each accepted addition out: its process handle's `publishEnv`. */
  publish: ((name: string, value: string) => void) | undefined;
  signal: AbortSignal;
}

/**
 * The additions one hook answers. Its throw takes the ordinary failure path: a failure class keeps
 * its class and exit code, and any other throw is a foreign throw.
 */
async function callHook(
  installed: BuiltPlugin,
  setup: EnvironmentSetup,
): Promise<[string, string][]> {
  const { host, log, out } = setup;
  const answer = await installed.onEnvironment?.({
    host: { cwd: host.cwd, env: Object.freeze({ ...host.env }) },
    log: log(installed.identity),
    out,
  });
  return setup.signal.aborted || !answer ? [] : Object.entries(answer);
}

/** Keep the captured map itself so output and log destinations observe additions as well. */
function mergeAdditions(setup: EnvironmentSetup, additions: readonly [string, string][]): void {
  const { host, publish } = setup;
  for (const [name, value] of additions) {
    if (!Object.hasOwn(host.env, name) || host.env[name] === undefined) {
      Object.defineProperty(host.env, name, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
      publish?.(name, value);
    }
  }
}

async function prepareEnvironment(setup: EnvironmentSetup): Promise<void> {
  const { plugins, signal } = setup;
  for (const installed of plugins) {
    if (signal.aborted) {
      return;
    }
    if (installed.onEnvironment !== undefined) {
      const additions = await callHook(installed, setup);
      if (signal.aborted) {
        return;
      }
      mergeAdditions(setup, additions);
    }
  }
}

export type { EnvironmentContext, EnvironmentHook };
export { prepareEnvironment };
