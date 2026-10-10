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

import { afterEach, expect, test } from 'vite-plus/test';

import { invoke, start } from '../../../scripts/test-process.js';

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

/** One run of the fixture application in the sandbox, its environment pointing into it. */
function run(
  box: Sandbox,
  argv: string[],
  env: Record<string, string | undefined> = {},
  settings?: Record<string, unknown>,
) {
  return invoke(fixture, argv, {
    cwd: box.work,
    env: {
      // The platform is pinned so a test reads the same row on every machine.
      // The darwin and win32 cases name their own.
      FIXTURE_PLATFORM: 'linux',
      HOME: box.home,
      USERPROFILE: box.home,
      XDG_STATE_HOME: box.state,
      ...(settings === undefined ? {} : { FIXTURE_SETTINGS: JSON.stringify(settings) }),
      ...env,
    },
  });
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

test('an application that installs logging() appends one pinned line for each event at or above info', () => {
  const box = sandbox();
  expect(run(box, ['log'])).toEqual({ status: 0, stderr: '', stdout: '' });
  expect(lines(box.file)).toEqual([logged.info, logged.warn, logged.error]);
});

test('level trace writes all five levels, in call order', () => {
  const box = sandbox();
  run(box, ['log'], {}, { level: 'trace' });
  expect(lines(box.file)).toEqual([
    logged.trace,
    logged.debug,
    logged.info,
    logged.warn,
    logged.error,
  ]);
});

test('a record holds its keys in the pinned order and omits the absent ones', () => {
  const box = sandbox();
  run(box, ['fail'], {}, { level: 'error' });
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

test('level error still writes the fatal record of a defect, with its stack', () => {
  const box = sandbox();
  const result = run(box, ['defect'], {}, { level: 'error' });
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

test('a record survives a process.exit() that follows the call', () => {
  const box = sandbox();
  expect(run(box, ['leave']).status).toBe(3);
  expect(lines(box.file)).toEqual([record('info', 'Before the exit.', {}, ['leave'])]);
});

// The file

test('file names a file inside the default directory', () => {
  const box = sandbox();
  run(box, ['log'], {}, { file: 'collector.jsonl' });
  expect(lines(join(box.state, 'heimdall', 'collector.jsonl'))).toEqual([
    logged.info,
    logged.warn,
    logged.error,
  ]);
  expect(existsSync(box.file)).toBe(false);
});

test('a relative file resolves inside the default directory and never in the working directory', () => {
  const box = sandbox();
  run(box, ['log'], {}, { file: 'logs/sub/collector.jsonl' });
  expect(lines(join(box.state, 'heimdall', 'logs', 'sub', 'collector.jsonl'))).toHaveLength(3);
  expect(readdirSync(box.work)).toEqual([]);
});

test('an absolute file writes where it names, creating the missing directories', () => {
  const box = sandbox();
  const file = join(box.root, 'elsewhere', 'deep', 'x.jsonl');
  run(box, ['log'], {}, { file });
  expect(lines(file)).toHaveLength(3);
  expect(existsSync(join(box.state, 'heimdall'))).toBe(false);
});

test('~/ resolves from the home directory the run was given', () => {
  const box = sandbox();
  run(box, ['log'], {}, { file: '~/x.jsonl' });
  expect(lines(join(box.home, 'x.jsonl'))).toHaveLength(3);
});

test('~/ resolves from USERPROFILE on win32 when HOME is unset', () => {
  const box = sandbox();
  const result = run(
    box,
    ['log'],
    { FIXTURE_HOST_ENV: JSON.stringify({ USERPROFILE: box.home }), FIXTURE_PLATFORM: 'win32' },
    { file: '~/x.jsonl' },
  );
  expect(result).toEqual({ status: 0, stderr: '', stdout: '' });
  expect(lines(join(box.home, 'x.jsonl'))).toHaveLength(3);
});

test('the darwin row resolves from HOME under Library/Logs', () => {
  const box = sandbox();
  run(box, ['log'], {
    FIXTURE_HOST_ENV: JSON.stringify({ HOME: box.home, XDG_STATE_HOME: box.state }),
    FIXTURE_PLATFORM: 'darwin',
  });
  expect(lines(join(box.home, 'Library', 'Logs', 'heimdall', 'heimdall.jsonl'))).toHaveLength(3);
  expect(existsSync(box.file)).toBe(false);
});

test('the win32 row resolves from LOCALAPPDATA under the application and Logs', () => {
  const box = sandbox();
  const local = join(box.root, 'local');
  run(box, ['log'], {
    FIXTURE_HOST_ENV: JSON.stringify({ HOME: box.home, LOCALAPPDATA: local }),
    FIXTURE_PLATFORM: 'win32',
  });
  expect(lines(join(local, 'heimdall', 'Logs', 'heimdall.jsonl'))).toHaveLength(3);
});

test.each([
  ['unset', undefined],
  ['not absolute', 'relative/state'],
])('XDG_STATE_HOME %s falls back to HOME/.local/state', (_name, xdg) => {
  const box = sandbox();
  const env = JSON.stringify({
    HOME: box.home,
    ...(xdg === undefined ? {} : { XDG_STATE_HOME: xdg }),
  });
  run(box, ['log'], { FIXTURE_HOST_ENV: env, FIXTURE_PLATFORM: 'linux' });
  expect(lines(join(box.home, '.local', 'state', 'heimdall', 'heimdall.jsonl'))).toHaveLength(3);
});

// Rotation

test('with maxBytes 200 and keep 2, writes past the size leave the file, .1, and .2', () => {
  const box = sandbox();
  run(box, ['burst', '5', '0', 'm'], {}, { keep: 2, maxBytes: 200 });
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

test('a copy of a file with no extension puts its number after the name', () => {
  const box = sandbox();
  run(box, ['burst', '3', '0', 'm'], {}, { file: 'hub', keep: 2, maxBytes: 200 });
  expect(readdirSync(join(box.state, 'heimdall')).toSorted()).toEqual(['hub', 'hub.1', 'hub.2']);
});

test('a record larger than maxBytes lands whole in a new file', () => {
  const box = sandbox();
  const settings = { maxBytes: 200 };
  run(box, ['burst', '1', '0', 's'], {}, settings);
  run(box, ['burst', '1', '600', 'big'], {}, settings);
  const directory = join(box.state, 'heimdall');
  const big = JSON.parse(readFileSync(join(directory, 'heimdall.jsonl'), 'utf8'));
  expect(big.message).toBe('big1');
  expect(big.fields.payload).toHaveLength(600);
  expect(JSON.parse(readFileSync(join(directory, 'heimdall.1.jsonl'), 'utf8')).message).toBe('s1');
  run(box, ['burst', '1', '0', 't'], {}, settings);
  expect(JSON.parse(readFileSync(join(directory, 'heimdall.jsonl'), 'utf8')).message).toBe('t1');
  expect(JSON.parse(readFileSync(join(directory, 'heimdall.1.jsonl'), 'utf8')).message).toBe(
    'big1',
  );
});

test('an oversize record written to a file that does not exist lands whole in it', () => {
  const box = sandbox();
  run(box, ['burst', '1', '600', 'big'], {}, { maxBytes: 200 });
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

test('two processes that append and rotate one file at once write every line whole', async () => {
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
  expect(messages.every((message) => /^[ab]-\d+-\d+$/u.test(message))).toBe(true);
  expect(new Set(messages).size).toBe(messages.length);
});

// The console

test('to console writes the same bytes to stderr as the file, and none to stdout', () => {
  const box = sandbox();
  const settings = { level: 'trace' };
  run(box, ['log'], {}, settings);
  const written = lines(box.file);
  const result = run(box, ['log'], {}, { ...settings, to: 'console' });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr.split('\n').slice(0, -1).map(pinned)).toEqual(written);
  expect(result.stderr.endsWith('\n')).toBe(true);
  expect(lines(box.file)).toEqual(written);
});

test('to console writes no file', () => {
  const box = sandbox();
  run(box, ['log'], {}, { to: 'console' });
  expect(readdirSync(box.state)).toEqual([]);
});

test('an app.invoke writes nothing to stderr with to console', () => {
  const box = sandbox();
  const result = run(box, ['invoke', 'log'], {}, { to: 'console' });
  expect(result).toEqual({ status: 0, stderr: '', stdout: 'invoked:completed\n' });
  expect(readdirSync(box.state)).toEqual([]);
});

test('an app.invoke still writes the file from the env it captured', () => {
  const box = sandbox();
  const result = run(box, ['invoke', 'log']);
  expect(result).toEqual({ status: 0, stderr: '', stdout: 'invoked:completed\n' });
  expect(lines(box.file)).toHaveLength(3);
});

test('an app.invoke writes the file from the env its host replaced', () => {
  const box = sandbox();
  const replaced = join(box.root, 'replaced');
  const result = run(box, ['invoke', 'log'], {
    FIXTURE_HOST_ENV: JSON.stringify({ XDG_STATE_HOME: replaced }),
  });
  expect(result).toEqual({ status: 0, stderr: '', stdout: 'invoked:completed\n' });
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
  () => {
    const box = sandbox();
    readOnly(join(box.state, 'heimdall'));
    const result = run(box, ['burst', '2', '0', 'm'], { FIXTURE_ON_ERROR: 'print' });
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
  () => {
    const box = sandbox();
    readOnly(box.state);
    const result = run(box, ['burst', '2', '0', 'm'], { FIXTURE_ON_ERROR: 'print' });
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

test('an unset HOME reports an unresolved directory that names the variable', () => {
  const box = sandbox();
  const result = run(box, ['burst', '2', '0', 'm'], {
    FIXTURE_HOST_ENV: '{}',
    FIXTURE_ON_ERROR: 'print',
    FIXTURE_PLATFORM: 'linux',
  });
  const failure = '{"kind":"unresolved-directory","path":null,"variable":"HOME"}';
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: `onError:${failure}\nonError:${failure}\n`,
  });
});

test('a rotation that fails reports it, and the record is still written', () => {
  const box = sandbox();
  const directory = join(box.state, 'heimdall');
  // A copy that is a directory cannot be deleted as the copy past keep.
  mkdirSync(join(directory, 'heimdall.1.jsonl', 'inside'), { recursive: true });
  const result = run(
    box,
    ['burst', '2', '0', 'm'],
    { FIXTURE_ON_ERROR: 'print' },
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
  () => {
    const box = sandbox();
    const writable = sandbox();
    readOnly(join(box.state, 'heimdall'));
    expect(run(box, ['log'])).toEqual({ status: 0, stderr: '', stdout: '' });
    const failed = run(box, ['fail']);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toBe(run(writable, ['fail']).stderr);
    expect(failed.stderr).not.toBe('');
  },
);

test.skipIf(!unprivileged)('a later record lands once the directory is writable', () => {
  const box = sandbox();
  const directory = join(box.state, 'heimdall');
  readOnly(directory);
  const result = run(box, ['heal', directory], { FIXTURE_ON_ERROR: 'print' });
  expect(result.stdout).toBe(
    `onError:${JSON.stringify({ cause: 'EACCES', kind: 'append', path: box.file })}\n`,
  );
  expect(lines(box.file)).toEqual([record('info', 'After healing.', {}, ['heal'])]);
});

test.skipIf(!unprivileged)(
  'an onError that throws is reported as a broken hook and the run exits 1',
  () => {
    const box = sandbox();
    readOnly(join(box.state, 'heimdall'));
    const result = run(box, ['log'], { FIXTURE_ON_ERROR: 'throw' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Plugin "@loomcli/plugins/logging" failed in onLog: ');
    expect(result.stderr).toContain('The callback broke.');
  },
);

// Settings

/** What one `logging()` call returns or throws under `settings`. */
function settingsOutcome(settings: unknown): unknown {
  const settingsFixture = new URL('fixtures/logging-settings.mjs', import.meta.url);
  const result = invoke(settingsFixture, settings === undefined ? [] : [JSON.stringify(settings)]);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return JSON.parse(result.stdout);
}

const identity = '@loomcli/plugins/logging';

/** The diagnostic a fault in `key` throws: its rule, sentence, and correction. */
function fault(key: string, problem: string, correction: string) {
  return {
    correction,
    findings: [{ call: 'logging', mark: `0.${key}` }],
    rule: `${identity}/settings`,
    sentence: `Plugin "${identity}" setting "${key}" ${problem}`,
  };
}

const wholeNumber = 'Supply a whole number of 1 or more.';
const fileValue =
  'Supply a file name, an absolute path, or a path under "~/", or omit the setting.';

test.each([['logging'], [5], [null], [['file']]])(
  'logging(%j) rejects settings that are not an object',
  (settings) => {
    expect(settingsOutcome(settings)).toEqual({
      correction: 'Supply a settings object, or omit the settings.',
      findings: [{ call: 'logging', mark: '0', note: `declared by plugin "${identity}"` }],
      rule: '@loomcli/core/not-an-object',
      sentence: `Plugin "${identity}" declares settings that are not an object.`,
    });
  },
);

test.each([
  [
    { to: 'stdout' },
    fault('to', 'is not "file" or "console".', 'Supply "file" or "console", or omit the setting.'),
  ],
  [{ file: 5 }, fault('file', 'is not a nonempty string without a control character.', fileValue)],
  [{ file: '' }, fault('file', 'is not a nonempty string without a control character.', fileValue)],
  [
    { file: 'a\nb.jsonl' },
    fault('file', 'is not a nonempty string without a control character.', fileValue),
  ],
  [
    { file: 'a\u0000b' },
    fault('file', 'is not a nonempty string without a control character.', fileValue),
  ],
  [
    { level: 'fatal' },
    fault(
      'level',
      'is not a written level.',
      'Supply "trace", "debug", "info", "warn", or "error", or omit the setting.',
    ),
  ],
  [
    { level: 3 },
    fault(
      'level',
      'is not a written level.',
      'Supply "trace", "debug", "info", "warn", or "error", or omit the setting.',
    ),
  ],
  [{ maxBytes: 0 }, fault('maxBytes', 'is not a positive whole number.', wholeNumber)],
  [{ maxBytes: 1.5 }, fault('maxBytes', 'is not a positive whole number.', wholeNumber)],
  [{ maxBytes: '200' }, fault('maxBytes', 'is not a positive whole number.', wholeNumber)],
  [
    { maxBytes: Number.MAX_SAFE_INTEGER + 1 },
    fault('maxBytes', 'is not a positive whole number.', wholeNumber),
  ],
  [{ keep: -1 }, fault('keep', 'is not a positive whole number.', wholeNumber)],
  [{ keep: 0 }, fault('keep', 'is not a positive whole number.', wholeNumber)],
  [
    { onError: 'ignore' },
    fault('onError', 'is not a function.', 'Supply a function, or omit the setting.'),
  ],
  [
    // The first key at fault in the contract's order is reported, not the first fault class.
    { keep: 2, level: 'x', to: 'console' },
    fault(
      'level',
      'is not a written level.',
      'Supply "trace", "debug", "info", "warn", or "error", or omit the setting.',
    ),
  ],
  [
    { file: 5, to: 'console' },
    fault(
      'file',
      'is not accepted when "to" is "console".',
      'Remove the setting, or set "to" to "file".',
    ),
  ],
  [
    { file: 'a.jsonl', to: 'console' },
    fault(
      'file',
      'is not accepted when "to" is "console".',
      'Remove the setting, or set "to" to "file".',
    ),
  ],
  [
    { maxBytes: 200, to: 'console' },
    fault(
      'maxBytes',
      'is not accepted when "to" is "console".',
      'Remove the setting, or set "to" to "file".',
    ),
  ],
  [
    { keep: 2, to: 'console' },
    fault(
      'keep',
      'is not accepted when "to" is "console".',
      'Remove the setting, or set "to" to "file".',
    ),
  ],
  [
    { onError: 'x', to: 'console' },
    fault(
      'onError',
      'is not accepted when "to" is "console".',
      'Remove the setting, or set "to" to "file".',
    ),
  ],
])('logging(%j) throws its pinned diagnostic', (settings, diagnostic) => {
  expect(settingsOutcome(settings)).toEqual(diagnostic);
});

test.each([
  [undefined],
  [{}],
  [{ to: 'file' }],
  [{ level: 'warn', to: 'console' }],
  [{ file: '~/x.jsonl', keep: 1, level: 'trace', maxBytes: 1 }],
])('logging(%j) accepts the settings', (settings) => {
  expect(settingsOutcome(settings)).toBe('returned');
});
