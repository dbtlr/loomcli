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

import { Application, Command, FatalError, readExtension } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { logging } from '@loomcli/plugins/logging';
import type { LoggingSettings } from '@loomcli/plugins/logging';
import { loggingFiles, resolveLoggingFiles } from '@loomcli/plugins/logging/extension';
import type { LoggingFilesFacts } from '@loomcli/plugins/logging/extension';
import { mockProcess } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';

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

// A process test under ADR-0103: the action ends a real process with process.exit().
// Only a record written before the process ended survives in the file.
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
  // Keeping 100 copies of 400 bytes leaves every record on disk.
  const first = start(turns, ['a', 'b', baton, '3', '5', '100', '400'], { cwd: box.work, env });
  const second = start(turns, ['b', 'a', baton, '3', '5', '100', '400'], { cwd: box.work, env });
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
  /**
   * With no baton both processes wait for each other to start, then rotate the small file over and
   * over, so their rotations collide. A 2,000-byte file holds about 10 records, so each process
   * rotates 20 to 30 times, more when both rotate at once, and 40 copies keep most of both
   * processes' records on disk for the checks below. Each rotation renames every copy up to keep,
   * so that is about 1,000 renames a process. The earlier 400 bytes and 100 copies made about
   * 10,000, which took over 4 seconds on macOS under Bun and ran past the fixture timeout on a
   * loaded runner.
   */
  const args = ['-', '20', '10', '40', '2000'];
  const first = start(turns, ['a', 'b', ...args], { cwd: box.work, env });
  const second = start(turns, ['b', 'a', ...args], { cwd: box.work, env });
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
    expect(reference.stderr).toContain(failed.stderr.trimEnd());
    expect(failed.stderr).not.toContain('Read the log of this run');
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

test('the application log level variable overrides the author before records are filtered', async () => {
  const box = sandbox();
  await run(box, ['log'], {
    env: { HEIMDALL_LOG_LEVEL: 'debug', HOME: box.home, XDG_STATE_HOME: box.state },
  });
  expect(lines(box.file)).toEqual([logged.debug, logged.info, logged.warn, logged.error]);
});

test.each(['DEBUG', ' debug '])(
  'the level variable accepts %j without a warning',
  async (value) => {
    const box = sandbox();
    const result = await run(box, ['log'], {
      env: { HEIMDALL_LOG_LEVEL: value, HOME: box.home, XDG_STATE_HOME: box.state },
    });
    expect(result.stderr).toBe('');
    expect(lines(box.file)).toEqual([logged.debug, logged.info, logged.warn, logged.error]);
  },
);

test.each(['', '   '])('an empty level variable %j is unset without a warning', async (value) => {
  const box = sandbox();
  const result = await run(box, ['log'], {
    env: { HEIMDALL_LOG_LEVEL: value, HOME: box.home, XDG_STATE_HOME: box.state },
  });
  expect(result.stderr).toBe('');
  expect(lines(box.file)).toEqual([logged.info, logged.warn, logged.error]);
});

test('the file variable redirects the first file and leaves the second file intact', async () => {
  const box = sandbox();
  const redirected = join(box.root, 'report.jsonl');
  const second = join(box.root, 'audit.jsonl');
  await run(
    box,
    ['log'],
    { env: { HEIMDALL_LOG_FILE: redirected, HOME: box.home, XDG_STATE_HOME: box.state } },
    { destinations: [{}, { file: second }] },
  );
  expect(lines(redirected)).toEqual([logged.info, logged.warn, logged.error]);
  expect(lines(second)).toEqual(lines(redirected));
  expect(existsSync(box.file)).toBe(false);
});

test('an unusable level warns visibly and retains the declared threshold', async () => {
  const box = sandbox();
  const result = await run(
    box,
    ['log'],
    { env: { HEIMDALL_LOG_LEVEL: 'verbose\nforged', HOME: box.home, XDG_STATE_HOME: box.state } },
    { level: 'warn' },
  );
  expect(result.stderr).toContain(String.raw`HEIMDALL_LOG_LEVEL=verbose\u000aforged`);
  expect(result.stderr).toContain('Use trace, debug, info, warn, or error');
  expect(result.stderr.split('\n').filter(Boolean)).toHaveLength(1);
  expect(lines(box.file)).toEqual([logged.warn, logged.error]);
});

test('a directory supplied as the file variable warns and keeps the declared file', async () => {
  const box = sandbox();
  const result = await run(box, ['log'], {
    env: { HEIMDALL_LOG_FILE: box.home, HOME: box.home, XDG_STATE_HOME: box.state },
  });
  expect(result.stderr).toContain('Set it to a writable file path');
  expect(lines(box.file)).toEqual([logged.info, logged.warn, logged.error]);
});

test('a missing directory with a trailing separator warns at verbosity zero and keeps the declared file', async () => {
  const box = sandbox();
  const directory = join(box.root, 'newdir');
  const result = await run(box, ['log'], {
    env: { HEIMDALL_LOG_FILE: `${directory}/`, HOME: box.home, XDG_STATE_HOME: box.state },
  });
  expect(result.stderr).toContain('Set it to a writable file path');
  expect(lines(box.file)).toEqual([logged.info, logged.warn, logged.error]);
  expect(existsSync(directory)).toBe(false);
});

test.skipIf(!existsSync('/dev/null'))(
  'the file variable accepts a writable device without a warning or fallback',
  async () => {
    const box = sandbox();
    const result = await run(
      box,
      ['log'],
      {
        env: { HEIMDALL_LOG_FILE: '/dev/null', HOME: box.home, XDG_STATE_HOME: box.state },
      },
      { maxBytes: 1 },
    );
    expect(result.stderr).toBe('');
    expect(existsSync(box.file)).toBe(false);
  },
);

test('authors can rename either variable and disable either variable', async () => {
  const box = sandbox();
  const file = join(box.root, 'named.jsonl');
  const env = {
    DETAIL: 'debug',
    HEIMDALL_LOG_FILE: box.work,
    HEIMDALL_LOG_LEVEL: 'trace',
    HOME: box.home,
    RECORD: file,
    XDG_STATE_HOME: box.state,
  };
  await run(box, ['log'], { env }, { fileEnv: 'RECORD', levelEnv: 'DETAIL' });
  expect(lines(file)).toEqual([logged.debug, logged.info, logged.warn, logged.error]);
  const result = await run(box, ['log'], { env }, { fileEnv: false, levelEnv: false });
  expect(result.stderr).toBe('');
  expect(lines(box.file)).toEqual([logged.info, logged.warn, logged.error]);
});

test('runtime failures name this run and its successfully appended file', async () => {
  const box = sandbox();
  const result = await run(box, ['fail']);
  const records = readFileSync(box.file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(result.stderr).toContain(
    `Read the log of this run in ${box.file} (run ${records[0].run}).`,
  );
});

test.each<NonNullable<LoggingSettings['failureHint']>>(['runtime', 'always', 'defects', false])(
  'failureHint %s selects runtime failures',
  async (failureHint) => {
    const box = sandbox();
    const result = await run(box, ['fail'], {}, { failureHint });
    expect(result.stderr.includes('Read the log of this run')).toBe(
      failureHint === 'runtime' || failureHint === 'always',
    );
  },
);

test.each<NonNullable<LoggingSettings['failureHint']>>(['runtime', 'always', 'defects', false])(
  'failureHint %s selects defects',
  async (failureHint) => {
    const box = sandbox();
    const result = await run(box, ['defect'], {}, { failureHint });
    expect(result.stderr.includes('Read the log of this run')).toBe(failureHint !== false);
  },
);

test('a usage error shows no default hint and a console-only run shows none', async () => {
  const box = sandbox();
  const usage = await run(box, ['missing']);
  expect(usage.stderr).not.toContain('Read the log of this run');
  const consoleOnly = await run(box, ['fail'], {}, { to: 'console' });
  expect(consoleOnly.stderr).not.toContain('Read the log of this run');
});

/** The logging fact `inspect()` publishes on the root of the fixture application. */
function publishedFacts(settings?: LoggingSettings): LoggingFilesFacts {
  const facts = readExtension(loggingApplication(settings).inspect().root, loggingFiles);
  if (facts === undefined) {
    throw new Error('The logging fact is missing.');
  }
  return facts;
}

test('inspect() carries the logging fact on the root, and the resolver gives a host its files', () => {
  const box = sandbox();
  const facts = publishedFacts({
    destinations: [{}, { to: 'console' }, { file: 'audit.jsonl', level: 'warn' }],
    fileEnv: 'RECORD',
  });
  expect(facts).toEqual({
    fileEnv: 'RECORD',
    files: [{ level: 'info' }, { file: 'audit.jsonl', level: 'warn' }],
  });
  const audit = join(box.state, 'heimdall', 'audit.jsonl');
  const host = {
    env: { HOME: box.home, XDG_STATE_HOME: box.state },
    home: box.home,
    platform: 'linux',
  };
  expect(resolveLoggingFiles(facts, { application: 'heimdall', host })).toEqual({
    files: [
      { level: 'info', path: box.file },
      { level: 'warn', path: audit },
    ],
    rejected: {},
  });
  const redirected = join(box.root, 'report.jsonl');
  const operated = {
    ...host,
    env: { ...host.env, HEIMDALL_LOG_LEVEL: 'debug', RECORD: redirected },
  };
  expect(resolveLoggingFiles(facts, { application: 'heimdall', host: operated }).files).toEqual([
    { level: 'debug', path: redirected },
    { level: 'debug', path: audit },
  ]);
  expect(existsSync(redirected)).toBe(false);
});

test('the resolver rejects an unusable value and names the variable a host lacks', () => {
  const box = sandbox();
  const facts = publishedFacts();
  const env = { HEIMDALL_LOG_FILE: '/var/log/heimdall/', HEIMDALL_LOG_LEVEL: 'loud' };
  const resolved = resolveLoggingFiles(facts, {
    application: 'heimdall',
    host: { env, home: 'relative', platform: 'linux' },
  });
  expect(resolved.rejected).toEqual({
    file: { value: '/var/log/heimdall/', variable: 'HEIMDALL_LOG_FILE' },
    level: { value: 'loud', variable: 'HEIMDALL_LOG_LEVEL' },
  });
  const [file] = resolved.files;
  expect(file !== undefined && 'error' in file && file.error.variable).toBe('HOME');
  expect(existsSync(box.file)).toBe(false);
});

test('the resolver counts an empty or blank file variable as unset', () => {
  const facts = publishedFacts();
  for (const value of ['', '   ']) {
    const host = { env: { HEIMDALL_LOG_FILE: value }, home: '/home/me', platform: 'linux' };
    expect(resolveLoggingFiles(facts, { application: 'heimdall', host }).rejected).toEqual({});
  }
});

test('a console-only installation publishes no file and reads neither variable', () => {
  const facts = publishedFacts({ to: 'console' });
  expect(facts).toEqual({ files: [] });
  const host = { env: { HEIMDALL_LOG_LEVEL: 'loud' }, home: '/home/me', platform: 'linux' };
  expect(resolveLoggingFiles(facts, { application: 'heimdall', host })).toEqual({
    files: [],
    rejected: {},
  });
});

test('always hints for a usage failure whose failure record is the first append', async () => {
  const box = sandbox();
  const result = await run(box, ['missing'], {}, { failureHint: 'always' });
  expect(result.stderr).toContain(`Read the log of this run in ${box.file}`);
});

test('the environment override covers configuration-source debug records before option resolution', async () => {
  const box = sandbox();
  writeFileSync(join(box.work, '.heimdall.json'), '{"value":"configured"}');
  const config = configuration({ schema: z.object({ value: z.string().optional() }) });
  const app = new Application('heimdall', { plugins: [config.plugin, logging()] })
    .option('value', { extensions: [configInput({ path: 'value' })], type: 'string' })
    .action(() => undefined);
  const mock = mockProcess({
    argv: [],
    cwd: box.work,
    env: { HEIMDALL_LOG_LEVEL: 'debug', HOME: box.home, XDG_STATE_HOME: box.state },
    home: box.home,
    platform: 'linux',
  });
  await app.run({ process: mock });
  expect(mock.exitCode).toBe(0);
  const records = readFileSync(box.file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(
    records.some((event) => event.plugin === '@loomcli/plugins/config' && event.level === 'debug'),
  ).toBe(true);
});

test('application names uppercase and replace punctuation in the default variable names', async () => {
  const box = sandbox();
  const file = join(box.root, 'report.jsonl');
  const app = new Application('my-tool', { plugins: [logging()] }).action(({ log }) => {
    log.debug('Detail.');
  });
  const mock = mockProcess({
    argv: [],
    cwd: box.work,
    env: { MY_TOOL_LOG_FILE: file, MY_TOOL_LOG_LEVEL: 'debug' },
    home: box.home,
    platform: 'linux',
  });
  await app.run({ process: mock });
  expect(JSON.parse(readFileSync(file, 'utf8')).message).toBe('Detail.');
});

test('concurrent runs of one application name only their own run id', async () => {
  const box = sandbox();
  const app = new Application('heimdall', { plugins: [logging()] }).command(
    new Command('fail', { description: 'Fail.' }).action(async ({ log }) => {
      log.info('Before failure.');
      await Promise.resolve();
      throw new FatalError('Failed.');
    }),
  );
  const env = { HOME: box.home, XDG_STATE_HOME: box.state };
  const first = mockProcess({
    argv: ['fail'],
    cwd: box.work,
    env,
    home: box.home,
    platform: 'linux',
  });
  const second = mockProcess({
    argv: ['fail'],
    cwd: box.work,
    env,
    home: box.home,
    platform: 'linux',
  });
  await Promise.all([app.run({ process: first }), app.run({ process: second })]);
  const firstRun = /\(run (?<id>[a-f0-9]{32})\)/u.exec(first.stderr.text)?.groups?.id;
  const secondRun = /\(run (?<id>[a-f0-9]{32})\)/u.exec(second.stderr.text)?.groups?.id;
  expect(firstRun).toBeDefined();
  expect(secondRun).toBeDefined();
  expect(firstRun).not.toBe(secondRun);
});

test('a nested invocation failure names its own records in the outer destination', async () => {
  const box = sandbox();
  let hints: readonly string[] = [];
  const app = new Application('heimdall', { plugins: [logging()] })
    .command(
      new Command('inner', { description: 'Fail.' }).action(() => {
        throw new FatalError('Failed inside.');
      }),
    )
    .action(async ({ invoke: call }) => {
      const outcome = await call(['inner'], {});
      if (outcome.status === 'failed') {
        hints = outcome.form.hints;
      }
    });
  const mock = mockProcess({
    argv: [],
    cwd: box.work,
    env: { HOME: box.home, XDG_STATE_HOME: box.state },
    home: box.home,
    platform: 'linux',
  });
  await app.run({ process: mock });
  expect(mock.exitCode).toBe(0);
  expect(hints.join('\n')).toContain(`Read the log of this run in ${box.file}`);
});

test('an invalid level warns at verbosity 0 on a run whose only event no file writes', async () => {
  const box = sandbox();
  const app = new Application('heimdall', { plugins: [logging()] }).action(({ log }) => {
    log.debug('Detail.');
  });
  const mock = mockProcess({
    argv: [],
    cwd: box.work,
    env: { HEIMDALL_LOG_LEVEL: 'verbose', HOME: box.home, XDG_STATE_HOME: box.state },
    home: box.home,
    platform: 'linux',
  });
  await app.run({ process: mock });
  expect(mock.exitCode).toBe(0);
  expect(mock.stderr.text).toContain('Use trace, debug, info, warn, or error');
  expect(existsSync(box.file)).toBe(false);
});

test('operator variables change files alone beside ordered OpenTelemetry and console entries', async () => {
  const box = sandbox();
  const redirected = join(box.root, 'operator.jsonl');
  const second = join(box.root, 'second.jsonl');
  const emitted: string[] = [];
  const app = new Application('heimdall', {
    plugins: [
      logging({
        destinations: [
          { level: 'error' },
          {
            level: 'info',
            logger: {
              emit: (entry) => {
                emitted.push(entry.body);
                expect(readFileSync(redirected, 'utf8')).toContain(entry.body);
                expect(readFileSync(second, 'utf8')).not.toContain(entry.body);
              },
            },
            to: 'otel',
          },
          { level: 'error', to: 'console' },
          { file: second, level: 'error' },
        ],
      }),
    ],
  }).action(({ log }) => {
    log.debug('Detail.');
    log.info('Ready.');
  });
  const facts = readExtension(app.inspect().root, loggingFiles);
  expect(facts).toEqual({
    files: [{ level: 'error' }, { file: second, level: 'error' }],
  });
  const mock = mockProcess({
    argv: [],
    cwd: box.work,
    env: {
      HEIMDALL_LOG_FILE: redirected,
      HEIMDALL_LOG_LEVEL: 'debug',
      HOME: box.home,
      XDG_STATE_HOME: box.state,
    },
    home: box.home,
    platform: 'linux',
  });
  await app.run({ process: mock });
  expect(mock.exitCode).toBe(0);
  expect(emitted).toEqual(['Ready.']);
  expect(mock.stderr.text).toBe('');
  expect(readFileSync(redirected, 'utf8')).toContain('Detail.');
  expect(readFileSync(second, 'utf8')).toContain('Detail.');
});
