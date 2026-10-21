import type { Log, LogBinder } from './log.js';
import type { BuiltPlugin } from './plugin.js';
import type { Host, Out } from './types.js';

/** Environment preparation precedes input validation and exposes no parsed invocation. */
interface EnvironmentContext {
  readonly host: {
    readonly cwd: Host['cwd'];
    readonly env: Readonly<Host['env']>;
  };
  readonly out: Pick<Out, 'warn'>;
  readonly log: Log;
}

type EnvironmentHook = (
  context: EnvironmentContext,
) => Readonly<Record<string, string>> | void | Promise<Readonly<Record<string, string>> | void>;

interface EnvironmentSetup {
  host: Host;
  log: LogBinder;
  out: Pick<Out, 'warn'>;
  plugins: readonly BuiltPlugin[];
  publish: boolean;
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
      if (publish && (!Object.hasOwn(process.env, name) || process.env[name] === undefined)) {
        process.env[name] = value;
      }
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
