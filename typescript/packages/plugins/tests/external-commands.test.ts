/**
 * Acceptance plan for the external-commands plugin (docs/plugins/external-commands.md, ADR-0192).
 *
 * - Without the plugin, and with it when no program answers, an unknown command prints and exits
 *   byte for byte as before, suggestions included, through `run()` and `invoke()`.
 * - `notes foo a --b` runs the first executable `notes-foo` on the run's `PATH` with `[a, --b]`
 *   and exits with its code; a signalled child exits 128 plus the signal's number.
 * - A declared `foo`, hidden or not, wins; a word with `/` and a word after an option are unknown.
 * - The search passes over a file without the execute bit, a directory, a dangling link, and a
 *   relative entry; with no candidate the run reports the unknown command.
 * - On Windows it reads `PATH` by Node's sorted-key rule, tries `.com` before `.exe`, and turns a
 *   code above 255 into 1.
 * - A candidate that fails to start exits 1 with the plugin's sentence.
 * - An invocation by name never starts a program.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command, plugin, processHandle } from '@loomcli/core';
import type { LogEvent } from '@loomcli/core';
import { externalCommands } from '@loomcli/plugins/external-commands';
import { help } from '@loomcli/plugins/help';
import { suggestions } from '@loomcli/plugins/suggestions';
import { mockProcess } from '@loomcli/testing';
import type { ProgramCall } from '@loomcli/testing';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';

/** Real child programs start only on POSIX, where a fixture is a `#!/bin/sh` script. */
const posix = process.platform !== 'win32';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'loom-external-commands-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** A folder under the sandbox, created empty. */
function folder(name: string): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  return path;
}

/** A file in a folder, written with the given body and mode. */
function file(directory: string, name: string, body = '#!/bin/sh\nexit 0\n', mode = 0o755): string {
  const path = join(directory, name);
  writeFileSync(path, body);
  chmodSync(path, mode);
  return path;
}

/** The application the goldens were taken from, with or without the plugin. */
function notes(options: { external?: boolean; foo?: 'declared' | 'hidden' } = {}) {
  const plugins = [
    help(),
    suggestions(),
    ...(options.external === false ? [] : [externalCommands()]),
  ];
  let app = new Application('notes', { plugins })
    .globalOption('dry-run', { type: 'boolean' })
    .command(new Command('add').action(() => {}))
    .command(new Command('list').action(() => {}))
    .command(new Command('secret', { hidden: true }).action(() => {}));
  if (options.foo !== undefined) {
    app = app.command(
      new Command('foo', { hidden: options.foo === 'hidden' }).action(({ out }) =>
        out.print('declared foo\n'),
      ),
    );
  }
  return app;
}

/** One mock run's exit code and streams. */
async function mockRun(
  app: Pick<ReturnType<typeof notes>, 'run'>,
  argv: string[],
  fields: Parameters<typeof mockProcess>[0] = {},
) {
  const mock = mockProcess({ argv, ...fields });
  const code = await app.run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

const unknown = (word: string) => ({
  code: 2,
  stderr: `notes: Unknown command "${word}". Use one of: add, list.\nRun "notes --help" to see the usage.\n`,
  stdout: '',
});

const goldens: [string[], { code: number; stderr: string; stdout: string }][] = [
  [['nope'], unknown('nope')],
  [['nope', '--bad'], unknown('nope')],
  [['--help', 'nope'], unknown('nope')],
  [['nope', 'a', '--b'], unknown('nope')],
  [
    ['lsit'],
    {
      code: 2,
      stderr:
        'notes: Unknown command "lsit". Did you mean "list"?\nRun "notes --help" to see the usage.\n',
      stdout: '',
    },
  ],
];

test('an unknown command prints and exits byte for byte as before, with and without the plugin', async () => {
  const env = { PATH: folder('empty') };
  for (const external of [false, true]) {
    for (const [argv, expected] of goldens) {
      await expect(mockRun(notes({ external }), argv, { env })).resolves.toEqual(expected);
    }
    await expect(
      notes({ external }).invoke(['nope'], {}, { process: mockProcess({ env }) }),
    ).resolves.toMatchObject({
      exitCode: 2,
      form: {
        code: 'unknown-command',
        exitCode: 2,
        hints: [],
        message: 'Unknown command "nope". Use one of: add, list.',
      },
      messages: 'notes: Unknown command "nope". Use one of: add, list.\n',
      output: '',
      status: 'failed',
    });
    await expect(
      notes({ external }).invoke(['lsit'], {}, { process: mockProcess({ env }) }),
    ).resolves.toMatchObject({ messages: 'notes: Unknown command "lsit". Did you mean "list"?\n' });
  }
});

/** A real run on the process, whose `exitCode` the test puts back afterwards. */
async function realRun(argv: string[], env: Record<string, string>): Promise<number> {
  const before = process.exitCode;
  try {
    return await notes().run({ process: processHandle({ argv, cwd: root, env }) });
  } finally {
    process.exitCode = before;
  }
}

test.skipIf(!posix)(
  'notes foo a --b runs notes-foo on PATH with [a, --b] and exits with its code',
  async () => {
    const bin = folder('bin');
    const out = join(root, 'argv.txt');
    file(bin, 'notes-foo', `#!/bin/sh\nprintf '%s\\n' "$@" > "$OUT"\nexit 7\n`);
    await expect(
      realRun(['foo', 'a', '--b'], { OUT: out, PATH: `${bin}:/usr/bin:/bin` }),
    ).resolves.toBe(7);
    expect(readFileSync(out, 'utf8')).toBe('a\n--b\n');
  },
);

test.skipIf(!posix)('a child a signal ends exits 128 plus the signal number', async () => {
  const bin = folder('bin');
  file(bin, 'notes-foo', '#!/bin/sh\nkill -TERM $$\n');
  await expect(realRun(['foo'], { PATH: `${bin}:/usr/bin:/bin` })).resolves.toBe(143);
});

/** A mock program that records its call and answers the given code. */
function recording(calls: ProgramCall[], code = 0) {
  return (call: ProgramCall) => {
    calls.push(call);
    return { code };
  };
}

test('a declared foo wins, and so does a hidden one', async () => {
  const bin = folder('bin');
  const program = file(bin, 'notes-foo');
  for (const foo of ['declared', 'hidden'] as const) {
    const calls: ProgramCall[] = [];
    await expect(
      mockRun(notes({ foo }), ['foo'], {
        env: { PATH: bin },
        programs: { [program]: recording(calls) },
      }),
    ).resolves.toEqual({ code: 0, stderr: '', stdout: 'declared foo\n' });
    expect(calls).toEqual([]);
  }
});

test('the program receives the words after the unknown one, in the run working directory and environment', async () => {
  const bin = folder('bin');
  const program = file(bin, 'notes-foo');
  const calls: ProgramCall[] = [];
  const env = { HOME: '/home/ada', PATH: bin };
  await expect(
    mockRun(notes(), ['foo', 'a', '--b', '--', 'c'], {
      cwd: root,
      env,
      programs: { [program]: recording(calls, 3) },
    }),
  ).resolves.toEqual({ code: 3, stderr: '', stdout: '' });
  expect(calls.map(({ args, cwd, env: seen }) => ({ args, cwd, env: seen }))).toEqual([
    { args: ['a', '--b', '--', 'c'], cwd: root, env },
  ]);
});

test('a word that is not a portable name is unknown, and no program starts', async () => {
  const bin = folder('bin');
  folder('bin/a');
  file(join(bin, 'a'), 'b');
  await expect(mockRun(notes(), ['a/b'], { env: { PATH: bin } })).resolves.toEqual({
    code: 2,
    stderr:
      'notes: Unknown command "a/b". Use one of: add, list.\nRun "notes --help" to see the usage.\n',
    stdout: '',
  });
  await expect(mockRun(notes(), ['.hidden'], { env: { PATH: bin } })).resolves.toMatchObject({
    code: 2,
  });
});

test('a word after an option is unknown, even with a program on PATH', async () => {
  const bin = folder('bin');
  file(bin, 'notes-foo');
  await expect(mockRun(notes(), ['--help', 'foo'], { env: { PATH: bin } })).resolves.toEqual(
    unknown('foo'),
  );
  await expect(mockRun(notes(), ['--dry-run', 'foo'], { env: { PATH: bin } })).resolves.toEqual(
    unknown('foo'),
  );
});

test('an unknown word under a group that repeats the first word is unknown, and no program starts', async () => {
  const bin = folder('bin');
  const program = file(bin, 'notes-cache');
  const calls: ProgramCall[] = [];
  const app = new Application('notes', { plugins: [externalCommands()] }).command(
    new Command('cache').command(new Command('clear').action(() => {})),
  );
  await expect(
    mockRun(app, ['cache', 'cache', '--all'], {
      env: { PATH: bin },
      programs: { [program]: recording(calls) },
    }),
  ).resolves.toMatchObject({ code: 2, stdout: '' });
  expect(calls).toEqual([]);
});

test('a file without the execute bit is passed over for an executable one later on PATH', async () => {
  const first = folder('first');
  const second = folder('second');
  file(first, 'notes-foo', '#!/bin/sh\n', 0o644);
  const program = file(second, 'notes-foo');
  const calls: ProgramCall[] = [];
  await expect(
    mockRun(notes(), ['foo'], {
      env: { PATH: `${first}:${second}` },
      programs: { [program]: recording(calls) },
    }),
  ).resolves.toEqual({ code: 0, stderr: '', stdout: '' });
  expect(calls).toHaveLength(1);
});

test('with only a file without the execute bit, the run reports the unknown command', async () => {
  const bin = folder('bin');
  file(bin, 'notes-foo', '#!/bin/sh\n', 0o644);
  await expect(mockRun(notes(), ['foo'], { env: { PATH: bin } })).resolves.toEqual(unknown('foo'));
});

test('a directory, a dangling link, and a relative entry are passed over', async () => {
  const bin = folder('bin');
  folder('bin/notes-foo');
  const links = folder('links');
  symlinkSync(join(root, 'missing'), join(links, 'notes-foo'));
  const relative = folder('relative');
  file(relative, 'notes-foo');
  await expect(
    mockRun(notes(), ['foo'], { cwd: root, env: { PATH: `${bin}:${links}::relative` } }),
  ).resolves.toEqual(unknown('foo'));
});

/** A program that could not start because the system refused it. */
function refused(): never {
  throw Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });
}

/** A program whose interpreter, or the file itself, is missing. */
function missing(): never {
  throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
}

test('a candidate that fails to start exits 1 with the sentence for its cause', async () => {
  const bin = folder('bin');
  const program = file(bin, 'notes-foo');
  await expect(
    mockRun(notes(), ['foo'], { env: { PATH: bin }, programs: { [program]: refused } }),
  ).resolves.toEqual({
    code: 1,
    stderr: `notes cannot run ${program}, because the system does not allow it to run. Check its permissions and the file system it is on, or remove it from PATH.\n`,
    stdout: '',
  });
  await expect(
    mockRun(notes(), ['foo'], { env: { PATH: bin }, programs: { [program]: missing } }),
  ).resolves.toMatchObject({
    code: 1,
    stderr: `notes cannot run ${program}, because the interpreter its first line names, or the file itself, is missing. Install the interpreter, or remove the file from PATH.\n`,
  });
});

test('on Windows, PATH wins over Path, .com comes before .exe, and a code above 255 exits 1', async () => {
  const bin = folder('bin');
  const other = folder('other');
  file(bin, 'notes-foo.exe');
  const com = file(bin, 'notes-foo.com');
  file(other, 'notes-foo.com');
  const calls: ProgramCall[] = [];
  await expect(
    mockRun(notes(), ['foo'], {
      env: { PATH: bin, Path: other },
      platform: 'win32',
      programs: { [com]: recording(calls, 3_221_225_477) },
    }),
  ).resolves.toEqual({ code: 1, stderr: '', stdout: '' });
  expect(calls).toHaveLength(1);
});

test('an invocation by name never starts a program', async () => {
  const bin = folder('bin');
  const program = file(bin, 'notes-foo');
  const calls: ProgramCall[] = [];
  const mock = mockProcess({ env: { PATH: bin }, programs: { [program]: recording(calls) } });
  await expect(notes().invoke(['foo'], {}, { process: mock })).resolves.toMatchObject({
    exitCode: 2,
    status: 'failed',
  });
  expect(calls).toEqual([]);
});

test('the plugin logs the program it starts and each entry it passes over', async () => {
  const empty = folder('empty');
  const bin = folder('bin');
  const program = file(bin, 'notes-foo');
  const seen: LogEvent[] = [];
  const observer = plugin('fixture/observer', {
    onLog: (event) => {
      seen.push(event);
      return undefined;
    },
  });
  const app = new Application('notes', { plugins: [observer, externalCommands()] }).command(
    new Command('add').action(() => {}),
  );
  const mock = mockProcess({
    argv: ['foo'],
    env: { PATH: `${empty}:${bin}` },
    programs: { [program]: () => ({}) },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(
    seen
      .filter((event) => event.plugin === '@loomcli/plugins/external-commands')
      .map(({ fields, level, message }) => ({ fields, level, message })),
  ).toEqual([
    {
      fields: { folder: empty, program: 'notes-foo' },
      level: 'trace',
      message: 'No {program} in {folder}.',
    },
    { fields: { program }, level: 'debug', message: 'Running {program}.' },
  ]);
});
