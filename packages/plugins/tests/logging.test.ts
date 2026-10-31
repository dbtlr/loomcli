/*
 * Acceptance plan for the logging plugin (docs/plugins/logging.md#logging-plugin).
 *
 * The plugin is proven when in-process tests under Node and Bun, each running an application on
 * mockProcess with a temporary home and state directory, produce these results. A record that
 * survives `process.exit()` and two processes writing one file need real processes, so those
 * cases start fixtures (ADR-0103):
 *
 * - Records. An application that installs `logging()` and logs at each level appends one pinned
 *   line per event at or above `info` to `$XDG_STATE_HOME/<app>/<app>.jsonl`, with the keys in the
 *   record order, and, with `level: 'error'`, a defect's `fatal` record still written with its
 *   stack.
 * - The file. `file: 'collector.jsonl'` writes inside the default directory, an absolute `file`
 *   writes where it names, `~/x.jsonl` resolves from the test's `HOME`, a missing directory is
 *   created, and a `darwin` fixture resolves its table row from an overridden `env` and `platform`.
 * - Rotation. With `maxBytes: 200` and `keep: 2`, writes past the size leave the file, `.1`, and
 *   `.2`, the oldest copy deleted; a record larger than `maxBytes` lands whole in a new file; two
 *   processes that take turns appending and rotating one file leave every record in the file or a
 *   copy; and two that append and rotate one file at once leave every line whole and none written
 *   twice.
 * - The console. `to: 'console'` writes the same bytes to stderr and none to stdout, and an
 *   `app.invoke` writes nothing to stderr while the file destination still writes.
 * - A failed write. A read-only directory calls `onError` with `kind` `create-directory` or
 *   `append` and the path for each record that fails, and an unset or relative `HOME` with
 *   `unresolved-directory` and `variable` `HOME`; with no `onError`, each run exits with its own
 *   code and writes nothing to stderr; a later record lands once the directory is writable; and an
 *   `onError` that throws is reported as a hook's throw with exit 1.
 * - Packaging. `pnpm check:packed` resolves `@loomcli/plugins/logging` from the packed tarball
 *   under Node and Bun.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LoggingSettings } from '@loomcli/plugins/logging';
import { mockProcess } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';

import { invoke, start } from '../../../scripts/test-process.js';
import type { Outcome } from './fixtures/in-process.ts';
import { loggingApplication } from './fixtures/logging-app.ts';
import type { OnError } from './fixtures/logging-app.ts';

const fixture = new URL('fixtures/logging-run.mjs', import.meta.url);
const turns = new URL('fixtures/logging-turns.mjs', import.meta.url);

/** A temporary home, state directory, and working directory, removed after the test. */
interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly state: string;
  readonly work: string;
  /** The default log file of the fixture application: `$XDG_STATE_HOME/heimdall/heimdall.jsonl`. */
  readonly file: string;
}

const roots: string[] = [];

function compare(first: string, second: string): number {
  return first.localeCompare(second);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    // A test that made a directory read-only leaves it so; make it removable first.
    chmodTree(root);
    rmSync(root, { force: true, recursive: true });
  }
});

/** Makes every directory under `root` writable, so the sandbox can be removed. */
function chmodTree(root: string): void {
  if (!existsSync(root)) {
    return;
  }
  chmodSync(root, 0o755);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      chmodTree(join(root, entry.name));
    }
  }
}

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'loom-logging-'));
  roots.push(root);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const work = join(root, 'work');
  for (const directory of [home, state, work]) {
    mkdirSync(directory);
  }
  return { file: join(state, 'heimdall', 'heimdall.jsonl'), home, root, state, work };
}

/** The host facts a case replaces, and the `onError` it picks. */
interface Facts {
  /** The run's whole environment; `HOME` and `XDG_STATE_HOME` in the sandbox when unnamed. */
  readonly env?: Record<string, string>;
  /** Pinned so a test reads the same row on every machine; the darwin case names its own. */
  readonly platform?: string;
  readonly onError?: 'print' | 'throw';
}

/** The throwing `onError` when the case picks it. */
function onErrorThrows(facts: Facts): OnError | undefined {
  return facts.onError === 'throw' ? { mode: 'throw' } : undefined;
}

/** The mock a case runs on, in the sandbox's working directory, and the application it runs. */
function prepare(box: Sandbox, argv: string[], facts: Facts, settings?: LoggingSettings) {
  const env = facts.env ?? { HOME: box.home, XDG_STATE_HOME: box.state };
  // The home is the HOME the run was given, as it is, and no home when there is none.
  const mock = mockProcess({
    argv,
    cwd: box.work,
    env,
    home: env.HOME ?? '',
    platform: facts.platform ?? 'linux',
  });
  // `print` writes each failure to the run's own stdout.
  const onError: OnError | undefined =
    facts.onError === 'print'
      ? { mode: 'print', write: (line) => mock.stdout.write(line) }
      : onErrorThrows(facts);
  return { app: loggingApplication(settings, onError), mock };
}

/** One run of the fixture application in the sandbox, its environment pointing into it. */
async function run(
  box: Sandbox,
  argv: string[],
  facts: Facts = {},
  settings?: LoggingSettings,
): Promise<Outcome> {
  const { app, mock } = prepare(box, argv, facts, settings);
  await app.run({ process: mock });
  if (mock.exitCode === undefined) {
    throw new Error('The application run did not record its exit code.');
  }
  return { status: mock.exitCode, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/** One `app.invoke(argv)` on the same facts, its outcome's status beside the mock's streams. */
async function invokeByName(
  box: Sandbox,
  argv: string[],
  facts: Facts = {},
  settings?: LoggingSettings,
) {
  const { app, mock } = prepare(box, [], facts, settings);
  const outcome = await app.invoke(argv, {}, { process: mock });
  return { status: outcome.status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/** A record's text with the two values that differ between runs, the time and the run id, fixed. */
function pinned(line: string): string {
  return line
    .replace(/"time":"[^"]+"/u, '"time":"T"')
    .replace(/"run":"[0-9a-f]{32}"/u, '"run":"R"');
}

/** The lines of a log file, pinned, with the closing newline of the last one checked. */
function lines(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  return text.slice(0, -1).split('\n').map(pinned);
}

/** The pinned record of a call at `level` under the path `log`, as the plugin writes it. */
function record(level: string, message: string, fields: Record<string, unknown>, path = ['log']) {
  const application = '{"name":"heimdall","version":"1.2.0"}';
  return `{"time":"T","level":"${level}","message":"${message}","fields":${JSON.stringify(fields)},"application":${application},"run":"R","path":${JSON.stringify(path)},"plugin":null}`;
}

const logged = {
  debug: record('debug', 'At debug.', { level: 'debug' }),
  error: record('error', 'At error.', { level: 'error' }),
  info: record('info', 'At info.', { level: 'info' }),
  trace: record('trace', 'At trace.', { level: 'trace' }),
  warn: record('warn', 'At warn.', { level: 'warn' }),
};

// Records

test('an application that installs logging() appends one pinned line for each event at or above info', async () => {
  const box = sandbox();
  await expect(run(box, ['log'])).resolves.toEqual({ status: 0, stderr: '', stdout: '' });
  expect(lines(box.file)).toEqual([logged.info, logged.warn, logged.error]);
});

test('level trace writes all five levels, in call order', async () => {
  const box = sandbox();
  await run(box, ['log'], {}, { level: 'trace' });
  expect(lines(box.file)).toEqual([
    logged.trace,
    logged.debug,
    logged.info,
    logged.warn,
    logged.error,
  ]);
});

test('a record holds its keys in the pinned order and omits the absent ones', async () => {
  const box = sandbox();
  await run(box, ['fail'], {}, { level: 'error' });
  const [only, ...rest] = lines(box.file);
  expect(rest).toEqual([]);
  expect(Object.keys(JSON.parse(only ?? ''))).toEqual([
    'time',
    'level',
    'message',
    'fields',
    'application',
    'run',
    'path',
    'plugin',
    'failure',
  ]);
});

test('level error still writes the fatal record of a defect, with its stack', async () => {
  const box = sandbox();
  const result = await run(box, ['defect'], {}, { level: 'error' });
  expect(result.status).toBe(1);
  const [only, ...rest] = lines(box.file);
  expect(rest).toEqual([]);
  const written = JSON.parse(only ?? '');
  expect(Object.keys(written)).toEqual([
    'time',
    'level',
    'message',
    'fields',
    'application',
    'run',
    'path',
    'plugin',
    'failure',
    'defect',
  ]);
  expect(written.level).toBe('fatal');
  expect(written.defect).toMatchObject({ message: 'The action failed.', name: 'TypeError' });
  expect(written.defect.stack).toContain('The action failed.');
});

// A process test under ADR-0103: the action ends a real process with process.exit(), and only a
// Record written before the process ended survives in the file.
test('a record survives a process.exit() that follows the call', async () => {
  const box = sandbox();
  expect(
    invoke(fixture, ['leave'], {
      cwd: box.work,
      env: { HOME: box.home, XDG_STATE_HOME: box.state },
    }).status,
  ).toBe(3);
  expect(lines(box.file)).toEqual([record('info', 'Before the exit.', {}, ['leave'])]);
});

// The file

test('file names a file inside the default directory', async () => {
  const box = sandbox();
  await run(box, ['log'], {}, { file: 'collector.jsonl' });
  expect(lines(join(box.state, 'heimdall', 'collector.jsonl'))).toEqual([
    logged.info,
    logged.warn,
    logged.error,
  ]);
  expect(existsSync(box.file)).toBe(false);
});

test('a relative file resolves inside the default directory and never in the working directory', async () => {
  const box = sandbox();
  await run(box, ['log'], {}, { file: 'logs/sub/collector.jsonl' });
  expect(lines(join(box.state, 'heimdall', 'logs', 'sub', 'collector.jsonl'))).toHaveLength(3);
  expect(readdirSync(box.work)).toEqual([]);
});

test('an absolute file writes where it names, creating the missing directories', async () => {
  const box = sandbox();
  const file = join(box.root, 'elsewhere', 'deep', 'x.jsonl');
  await run(box, ['log'], {}, { file });
  expect(lines(file)).toHaveLength(3);
  expect(existsSync(join(box.state, 'heimdall'))).toBe(false);
});

test('~/ resolves from the home directory the run was given', async () => {
  const box = sandbox();
  await run(box, ['log'], {}, { file: '~/x.jsonl' });
  expect(lines(join(box.home, 'x.jsonl'))).toHaveLength(3);
});

test('the darwin row resolves from HOME under Library/Logs', async () => {
  const box = sandbox();
  await run(box, ['log'], {
    env: { HOME: box.home, XDG_STATE_HOME: box.state },
    platform: 'darwin',
  });
  expect(lines(join(box.home, 'Library', 'Logs', 'heimdall', 'heimdall.jsonl'))).toHaveLength(3);
  expect(existsSync(box.file)).toBe(false);
});

test.each([
  ['unset', undefined],
  ['not absolute', 'relative/state'],
])('XDG_STATE_HOME %s falls back to HOME/.local/state', async (_name, xdg) => {
  const box = sandbox();
  const env = { HOME: box.home, ...(xdg === undefined ? {} : { XDG_STATE_HOME: xdg }) };
  await run(box, ['log'], { env, platform: 'linux' });
  expect(lines(join(box.home, '.local', 'state', 'heimdall', 'heimdall.jsonl'))).toHaveLength(3);
});

// Rotation

test('with maxBytes 200 and keep 2, writes past the size leave the file, .1, and .2', async () => {
  const box = sandbox();
  await run(box, ['burst', '5', '0', 'm'], {}, { keep: 2, maxBytes: 200 });
  const directory = join(box.state, 'heimdall');
  expect(readdirSync(directory).toSorted()).toEqual([
    'heimdall.1.jsonl',
    'heimdall.2.jsonl',
    'heimdall.jsonl',
  ]);
  const message = (name: string) => JSON.parse(readFileSync(join(directory, name), 'utf8')).message;
  expect([
    message('heimdall.jsonl'),
    message('heimdall.1.jsonl'),
    message('heimdall.2.jsonl'),
  ]).toEqual(['m5', 'm4', 'm3']);
});

test('with keep 0, a write past maxBytes deletes the file and a new one starts, with no copy', async () => {
  const box = sandbox();
  await run(box, ['burst', '3', '0', 'm'], {}, { keep: 0, maxBytes: 200 });
  expect(readdirSync(join(box.state, 'heimdall'))).toEqual(['heimdall.jsonl']);
  expect(lines(box.file).map((line) => JSON.parse(line).message)).toEqual(['m3']);
});

test('a copy of a file with no extension puts its number after the name', async () => {
  const box = sandbox();
  await run(box, ['burst', '3', '0', 'm'], {}, { file: 'hub', keep: 2, maxBytes: 200 });
  expect(readdirSync(join(box.state, 'heimdall')).toSorted()).toEqual(['hub', 'hub.1', 'hub.2']);
});

test('a record larger than maxBytes lands whole in a new file', async () => {
  const box = sandbox();
  const settings = { maxBytes: 200 };
  await run(box, ['burst', '1', '0', 's'], {}, settings);
  await run(box, ['burst', '1', '600', 'big'], {}, settings);
  const directory = join(box.state, 'heimdall');
  const big = JSON.parse(readFileSync(join(directory, 'heimdall.jsonl'), 'utf8'));
  expect(big.message).toBe('big1');
  expect(big.fields.payload).toHaveLength(600);
  expect(JSON.parse(readFileSync(join(directory, 'heimdall.1.jsonl'), 'utf8')).message).toBe('s1');
  await run(box, ['burst', '1', '0', 't'], {}, settings);
  expect(JSON.parse(readFileSync(join(directory, 'heimdall.jsonl'), 'utf8')).message).toBe('t1');
  expect(JSON.parse(readFileSync(join(directory, 'heimdall.1.jsonl'), 'utf8')).message).toBe(
    'big1',
  );
});

test('an oversize record written to a file that does not exist lands whole in it', async () => {
  const box = sandbox();
  await run(box, ['burst', '1', '600', 'big'], {}, { maxBytes: 200 });
  expect(readdirSync(join(box.state, 'heimdall'))).toEqual(['heimdall.jsonl']);
  expect(JSON.parse(readFileSync(box.file, 'utf8')).fields.payload).toHaveLength(600);
});

test('two processes that take turns appending and rotating one file lose no record', async () => {
  const box = sandbox();
  const baton = join(box.root, 'baton');
  writeFileSync(baton, 'a');
  const env = { HOME: box.home, XDG_STATE_HOME: box.state };
  // Each process waits for the baton, writes a batch that crosses the size twice, and hands it on.
  const first = start(turns, ['a', 'b', baton, '3', '5'], { cwd: box.work, env });
  const second = start(turns, ['b', 'a', baton, '3', '5'], { cwd: box.work, env });
  const results = await Promise.all([first.exit, second.exit]);
  expect(results.map(({ status, stderr }) => ({ status, stderr }))).toEqual([
    { status: 0, stderr: '' },
    { status: 0, stderr: '' },
  ]);
  const directory = join(box.state, 'heimdall');
  const messages: string[] = readdirSync(directory).flatMap((name) =>
    readFileSync(join(directory, name), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line).message),
  );
  const expected = ['a', 'b'].flatMap((turn) =>
    [1, 2, 3].flatMap((round) => [1, 2, 3, 4, 5].map((number) => `${turn}-${round}-${number}`)),
  );
  expect(messages.toSorted(compare)).toEqual(expected.toSorted(compare));
});

test('two processes that append and rotate one file at once write every line whole, none twice', async () => {
  const box = sandbox();
  const env = { HOME: box.home, XDG_STATE_HOME: box.state };
  // With no baton both processes rotate the small file over and over, so their rotations collide.
  const first = start(turns, ['a', 'b', '-', '20', '10'], { cwd: box.work, env });
  const second = start(turns, ['b', 'a', '-', '20', '10'], { cwd: box.work, env });
  const results = await Promise.all([first.exit, second.exit]);
  expect(results.map(({ status, stderr }) => ({ status, stderr }))).toEqual([
    { status: 0, stderr: '' },
    { status: 0, stderr: '' },
  ]);
  const directory = join(box.state, 'heimdall');
  const written = readdirSync(directory).flatMap((name) =>
    readFileSync(join(directory, name), 'utf8')
      .split('\n')
      .filter((line) => line !== ''),
  );
  // A simultaneous rotation may lose records from a copy, but no line is torn or written twice.
  const messages: string[] = written.map((line) => JSON.parse(line).message);
  expect(messages.length).toBeGreaterThan(0);
  expect(messages.every((message) => /^[ab]-\d+-\d+$/u.test(message))).toBe(true);
  expect(new Set(messages).size).toBe(messages.length);
});

// The console

test('to console writes the same bytes to stderr as the file, and none to stdout', async () => {
  const box = sandbox();
  const settings: LoggingSettings = { level: 'trace' };
  await run(box, ['log'], {}, settings);
  const written = lines(box.file);
  const result = await run(box, ['log'], {}, { ...settings, to: 'console' });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr.split('\n').slice(0, -1).map(pinned)).toEqual(written);
  expect(result.stderr.endsWith('\n')).toBe(true);
  expect(lines(box.file)).toEqual(written);
});

test('to console writes no file', async () => {
  const box = sandbox();
  await run(box, ['log'], {}, { to: 'console' });
  expect(readdirSync(box.state)).toEqual([]);
});

test('an app.invoke writes nothing to stderr with to console', async () => {
  const box = sandbox();
  const result = await invokeByName(box, ['log'], {}, { to: 'console' });
  expect(result).toEqual({ status: 'completed', stderr: '', stdout: '' });
  expect(readdirSync(box.state)).toEqual([]);
});

test('an app.invoke still writes the file from the env it captured', async () => {
  const box = sandbox();
  const result = await invokeByName(box, ['log']);
  expect(result).toEqual({ status: 'completed', stderr: '', stdout: '' });
  expect(lines(box.file)).toHaveLength(3);
});

test('an app.invoke writes the file from the env its host replaced', async () => {
  const box = sandbox();
  const replaced = join(box.root, 'replaced');
  const result = await invokeByName(box, ['log'], { env: { XDG_STATE_HOME: replaced } });
  expect(result).toEqual({ status: 'completed', stderr: '', stdout: '' });
  expect(lines(join(replaced, 'heimdall', 'heimdall.jsonl'))).toHaveLength(3);
  expect(existsSync(box.file)).toBe(false);
});

// A failed write

const unprivileged = process.getuid?.() !== 0;

/** A directory that exists and cannot be written to. */
function readOnly(path: string): void {
  mkdirSync(path, { recursive: true });
  chmodSync(path, 0o555);
}

test.skipIf(!unprivileged)(
  'a read-only log directory reports an append failure for each record',
  async () => {
    const box = sandbox();
    readOnly(join(box.state, 'heimdall'));
    const result = await run(box, ['burst', '2', '0', 'm'], { onError: 'print' });
    const failure = { cause: 'EACCES', kind: 'append', path: box.file };
    expect(result).toEqual({
      status: 0,
      stderr: '',
      stdout: `onError:${JSON.stringify(failure)}\nonError:${JSON.stringify(failure)}\n`,
    });
  },
);

test.skipIf(!unprivileged)(
  'a state directory that cannot hold the log directory reports a create-directory failure for each record',
  async () => {
    const box = sandbox();
    readOnly(box.state);
    const result = await run(box, ['burst', '2', '0', 'm'], { onError: 'print' });
    const failure = {
      cause: 'EACCES',
      kind: 'create-directory',
      path: join(box.state, 'heimdall'),
    };
    expect(result.stdout).toBe(
      `onError:${JSON.stringify(failure)}\nonError:${JSON.stringify(failure)}\n`,
    );
    expect(result.stderr).toBe('');
  },
);

test('an unset HOME reports an unresolved directory that names the variable', async () => {
  const box = sandbox();
  const result = await run(box, ['burst', '2', '0', 'm'], {
    env: {},
    onError: 'print',
    platform: 'linux',
  });
  const failure = '{"kind":"unresolved-directory","path":null,"variable":"HOME"}';
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: `onError:${failure}\nonError:${failure}\n`,
  });
});

test.each([
  ['the default directory', undefined],
  ['a file under ~/', '~/x.jsonl'],
])('a relative HOME reports an unresolved directory for %s', async (_case, file) => {
  const box = sandbox();
  const result = await run(
    box,
    ['burst', '1', '0', 'm'],
    { env: { HOME: 'home' }, onError: 'print' },
    file === undefined ? undefined : { file },
  );
  const failure = '{"kind":"unresolved-directory","path":null,"variable":"HOME"}';
  expect(result).toEqual({ status: 0, stderr: '', stdout: `onError:${failure}\n` });
  expect(readdirSync(box.work)).toEqual([]);
});

test('a rotation that fails reports it, and the record is still written', async () => {
  const box = sandbox();
  const directory = join(box.state, 'heimdall');
  // A copy that is a directory cannot be deleted as the copy past keep.
  mkdirSync(join(directory, 'heimdall.1.jsonl', 'inside'), { recursive: true });
  const result = await run(
    box,
    ['burst', '2', '0', 'm'],
    { onError: 'print' },
    { keep: 1, maxBytes: 200 },
  );
  const reported = result.stdout.trimEnd().split('\n');
  expect(reported).toHaveLength(1);
  expect(JSON.parse((reported[0] ?? '').slice('onError:'.length))).toMatchObject({
    kind: 'rotate',
    path: box.file,
  });
  expect(lines(box.file)).toHaveLength(2);
});

test.skipIf(!unprivileged)(
  'with no onError a failed write leaves the run its own exit code and writes nothing to stderr',
  async () => {
    const box = sandbox();
    const writable = sandbox();
    readOnly(join(box.state, 'heimdall'));
    await expect(run(box, ['log'])).resolves.toEqual({ status: 0, stderr: '', stdout: '' });
    const failed = await run(box, ['fail']);
    expect(failed.status).toBe(1);
    const reference = await run(writable, ['fail']);
    expect(failed.stderr).toBe(reference.stderr);
    expect(failed.stderr).not.toBe('');
  },
);

test.skipIf(!unprivileged)('a later record lands once the directory is writable', async () => {
  const box = sandbox();
  const directory = join(box.state, 'heimdall');
  readOnly(directory);
  const result = await run(box, ['heal', directory], { onError: 'print' });
  expect(result.stdout).toBe(
    `onError:${JSON.stringify({ cause: 'EACCES', kind: 'append', path: box.file })}\n`,
  );
  expect(lines(box.file)).toEqual([record('info', 'After healing.', {}, ['heal'])]);
});

test.skipIf(!unprivileged)(
  'an onError that throws is reported as a foreign throw from the hook and the run exits 1',
  async () => {
    const box = sandbox();
    readOnly(join(box.state, 'heimdall'));
    const result = await run(box, ['log'], { onError: 'throw' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(
      /^-- UNHANDLED EXCEPTION -+ @loomcli\/core\/foreign-throw\n\nThe callback broke\.\n/mu,
    );
  },
);
