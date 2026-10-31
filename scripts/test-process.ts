import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as after } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

/** How long a fixture may run or stay silent before the harness ends it and the test fails. */
const fixtureTimeout = 10_000;

/** Each runtime's own executable, by the name a test gives it, read once per test process. */
const executables = new Map<string, string>();

/**
 * The runtime's own executable rather than the name on PATH, which a version manager's shim may
 * answer. A shim reads the working directory itself, so it warns from a removed one.
 */
function runtimeExecutable(runtime: string): string {
  const known = executables.get(runtime);
  if (known !== undefined) {
    return known;
  }
  const result = spawnSync(runtime, ['-e', 'process.stdout.write(process.execPath)'], {
    encoding: 'utf8',
    timeout: fixtureTimeout,
  });
  if (result.error) {
    throw result.error;
  }
  executables.set(runtime, result.stdout);
  return result.stdout;
}

/**
 * The state directory every fixture shares unless a test names its own, under the temporary
 * directory, so an application that logs through the logging plugin writes its file here. The
 * plugin rotates the file, so it stays small.
 */
const sharedState = join(tmpdir(), 'loom-test-state');

/**
 * The home directory every fixture shares unless a test names its own. The logging plugin writes
 * under the home on macOS (`Library/Logs`), where `XDG_STATE_HOME` does not apply, so a fixture's
 * home is a temporary directory on every platform, never the developer's own.
 */
const sharedHome = join(tmpdir(), 'loom-test-home');

/**
 * The environment a fixture runs in, which the harness builds instead of inheriting. From the
 * parent it takes only `PATH`, so a fixture finds the runtimes and programs the machine has, and the
 * temporary directory, so a path a test builds under `tmpdir()` is the one the fixture sees. The
 * home is a temporary one and the cache, configuration, and data folders follow it, so a fixture
 * reads no configuration from the developer's home and writes nothing there, and git reads no system
 * configuration. A test that names its own home moves those folders with it, and one that unsets
 * the home leaves them unset. Nothing else reaches a fixture: a color, pager, or terminal setting, a
 * `CI` the runner sets, or a binding an example reads would otherwise change what the fixture
 * prints. The test's own variables and the capture marker apply on top, and a variable a test sets
 * to `undefined` stays unset.
 */
export function childEnvironment(
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const home = 'HOME' in env ? env.HOME : sharedHome;
  const built: Record<string, string | undefined> = {
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: home,
    LOOM_CAPTURE_TEST: 'present',
    PATH: process.env.PATH,
    TMPDIR: tmpdir(),
    ...(home === undefined
      ? {}
      : {
          XDG_CACHE_HOME: join(home, '.cache'),
          XDG_CONFIG_HOME: join(home, '.config'),
          XDG_DATA_HOME: join(home, '.local', 'share'),
        }),
    XDG_STATE_HOME: sharedState,
    ...env,
  };
  return Object.fromEntries(
    Object.entries(built).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * Runs one file as a process under the runtime the test run names, or under the one a case names,
 * such as Bun for an application's source, which only Bun runs directly.
 */
export function invoke(
  file: URL,
  args: string[] = [],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    input?: string;
    runtime?: string;
  } = {},
) {
  const { env, runtime, ...rest } = options;
  const result = spawnSync(
    runtime ?? process.env.LOOM_TEST_RUNTIME ?? 'node',
    [fileURLToPath(file), ...args],
    {
      ...rest,
      encoding: 'utf8',
      env: childEnvironment(env),
      timeout: fixtureTimeout,
    },
  );
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/**
 * Runs one file as `invoke` does, from a working directory removed before the runtime starts, as
 * an operator's shell that sits in a deleted directory runs it.
 */
export function invokeFromRemovedDirectory(
  file: URL,
  args: string[] = [],
  options: { env?: Record<string, string | undefined>; runtime?: string } = {},
) {
  const { env, runtime } = options;
  const executable = runtimeExecutable(runtime ?? process.env.LOOM_TEST_RUNTIME ?? 'node');
  const directory = mkdtempSync(join(tmpdir(), 'loom-removed-'));
  try {
    const result = spawnSync(
      'sh',
      [
        '-c',
        'cd "$0" && rmdir "$0" && exec "$@"',
        directory,
        executable,
        fileURLToPath(file),
        ...args,
      ],
      { encoding: 'utf8', env: childEnvironment(env), timeout: fixtureTimeout },
    );
    if (result.error) {
      throw result.error;
    }
    return { status: result.status, stderr: result.stderr, stdout: result.stdout };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** How the fixture ended: the status it resolved, or the signal that ended it, and its output. */
export interface Completion {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * The same fixture spawned asynchronously under the runtime the test run names, or under the one a
 * case names, so a test can wait for a line the child announced and then send it a signal. `exit`
 * resolves once the child has ended and both of its streams closed, which is how a signal that
 * ended the process rather than a status is observed.
 */
export function start(
  file: URL,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string | undefined>; runtime?: string } = {},
) {
  const { cwd, env, runtime } = options;
  const executable = runtime ?? process.env.LOOM_TEST_RUNTIME ?? 'node';
  const child = spawn(executable, [fileURLToPath(file), ...args], {
    ...(cwd === undefined ? {} : { cwd }),
    env: childEnvironment(env),
    // A fixture's run starts a shutdown on SIGTERM, which a handler or a host listener can outlast.
    // The harness therefore ends a stuck child with a signal no listener can absorb.
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: fixtureTimeout,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  /** How the exit promise settled, read by `announced` so a child that closed early fails fast. */
  let settlement:
    | { kind: 'closed'; status: number | null; signal: NodeJS.Signals | null }
    | { kind: 'errored'; error: Error }
    | undefined = undefined;
  const exit = new Promise<Completion>((resolve, reject) => {
    child.on('error', (error) => {
      settlement = { error, kind: 'errored' };
      reject(error);
    });
    child.on('close', (status, signal) => {
      settlement = { kind: 'closed', signal, status };
      resolve({ signal, status, stderr, stdout });
    });
  });
  /** Waits until the child wrote the announced line, so a signal lands where a test means it. */
  const announced = async (line: string): Promise<void> => {
    const deadline = Date.now() + fixtureTimeout;
    while (!stdout.includes(`${line}\n`)) {
      if (settlement) {
        const cause =
          settlement.kind === 'closed'
            ? `status ${settlement.status}, signal ${settlement.signal}`
            : `error ${settlement.error.message}`;
        throw new Error(
          `The fixture ended (${cause}) before announcing "${line}". It wrote:\n${stdout}${stderr}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(
          `The fixture never announced "${line}" within ${fixtureTimeout} ms. It wrote:\n${stdout}${stderr}`,
        );
      }
      await after(10);
    }
  };
  return { announced, child, exit };
}
