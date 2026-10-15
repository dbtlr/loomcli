import { InternalError } from './errors.js';
import type { Log, LogBinder } from './log.js';
import { isPlainObject } from './plain.js';
import { pluginSentence } from './plugin.js';
import type { BuiltPlugin } from './plugin.js';
import { brokenEnvironmentHook } from './rules.js';
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

function hookFailure(identity: string, options?: ErrorOptions): InternalError {
  return new InternalError(brokenEnvironmentHook, {
    cause: options?.cause,
    correction:
      'Return a record of variable names to strings without NUL, or nothing, and throw nothing.',
    sentence: `${pluginSentence(identity)} failed in onEnvironment.`,
  });
}

/** Read the entire answer before changing either environment; diagnostics never repeat its data. */
function readAdditions(value: unknown, identity: string): [string, string][] {
  if (value === undefined) {
    return [];
  }
  if (!isPlainObject(value)) {
    throw hookFailure(identity);
  }
  const entries: [string, string][] = [];
  for (const [name, item] of Object.entries(value)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) ||
      typeof item !== 'string' ||
      item.includes('\0')
    ) {
      throw hookFailure(identity);
    }
    entries.push([name, item]);
  }
  return entries;
}

async function callHook(
  installed: BuiltPlugin,
  setup: EnvironmentSetup,
): Promise<[string, string][]> {
  const { host, log, out } = setup;
  try {
    const answer: unknown = await installed.onEnvironment?.({
      host: { cwd: host.cwd, env: Object.freeze({ ...host.env }) },
      log: log(installed.identity),
      out,
    });
    return setup.signal.aborted ? [] : readAdditions(answer, installed.identity);
  } catch (error) {
    throw hookFailure(installed.identity, { cause: error });
  }
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
