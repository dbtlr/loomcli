/**
 * The process handle a run reads its facts from and makes its effects on, under ADR-0107. Every
 * case runs in the test's own process.
 *
 * - processHandle. A supplied field replaces its whole field, so an environment map replaces the
 *   process's rather than merging into it. A `cwd` string is the working directory: an absolute one
 *   never throws, and a relative one resolves against the process's working directory at each read,
 *   so a removed one fails the run as an unsupplied one does. A `cwd` function's throw fails the
 *   run with WorkingDirectoryError. A fact it was not given reads the process when core reads it,
 *   so one handle reused across runs reads current facts. Every handle shares the real process's
 *   one signal source, and has `publishEnv` only when it was given neither `env` nor `cwd`.
 * - Effects. `run()` writes its code to its handle's `exitCode` and never to `process.exitCode`
 *   for a hand-built handle, and `app.invoke` writes none. Core's lane listens and re-raises on
 *   the handle's signal source.
 * - Host facts. `arch`, `libc`, and `uid` copy from the handle, and `app.invoke` reads `env`,
 *   `cwd`, `platform`, and `release` from it. `host.raise` raises on the source and answers true only
 *   when stdin is the source's own terminal.
 */
import { Readable, Writable } from 'node:stream';

import { afterEach, expect, test, vi } from 'vite-plus/test';

import { Application, processHandle, WorkingDirectoryError } from '../src/index.js';
import type { ExitCode, Host, ProcessHandle, ProcessSignal, SignalSource } from '../src/index.js';

/** A stream that keeps what a run writes to it. */
function sink(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  return { stream, text: () => chunks.join('') };
}

/** A signal source of the test's own, recording what core asks of it. */
function ownSource(terminal?: Readable) {
  const listeners = new Map<string, () => void>();
  const raised: ProcessSignal[] = [];
  const off = vi.fn((event: string) => {
    listeners.delete(event);
  });
  const on = vi.fn((event: string, listener: () => void) => {
    listeners.set(event, listener);
  });
  const source: SignalSource = {
    off,
    on,
    raise: (signal) => {
      raised.push(signal);
    },
    terminal,
  };
  return { listeners, off, on, raised, source };
}

/** A handle built by hand, reading nothing from the process, with a stdout that keeps its text. */
function handBuilt(fields: Partial<ProcessHandle> = {}) {
  const stdout = sink();
  const handle: ProcessHandle = {
    arch: 'arm64',
    argv: [],
    cwd: () => '/work',
    env: {},
    exitCode: undefined,
    home: '/home/notes',
    libc: 'musl',
    platform: 'linux',
    program: ['/bin/notes'],
    release: { build: 'distributed' },
    signals: ownSource().source,
    spawn: () => {
      throw new Error('This handle starts no child.');
    },
    stderr: sink().stream,
    stdin: Readable.from([]),
    stdout: stdout.stream,
    terminal: {
      stderr: { columns: undefined, isTTY: false, rows: undefined },
      stdin: { isTTY: false },
      stdout: { columns: undefined, isTTY: false, rows: undefined },
    },
    timeZone: 'UTC',
    tmpdir: '/tmp',
    uid: 501,
    ...fields,
  };
  return { handle, stdout };
}

/** An application that prints the host facts its action reads. */
const facts = new Application('notes').action(({ host, out }) =>
  out.print(
    JSON.stringify({
      arch: host.arch,
      argv: host.argv,
      cwd: host.cwd,
      env: host.env,
      libc: host.libc,
      platform: host.platform,
      release: host.release,
      uid: host.uid,
    }),
  ),
);

const exitCode = process.exitCode;
const argv = [...process.argv];
afterEach(() => {
  process.exitCode = exitCode;
  process.argv = [...argv];
  delete process.env.LOOM_HANDLE_TEST;
  vi.restoreAllMocks();
});

test('a supplied environment replaces the process environment rather than merging into it', async () => {
  process.env.LOOM_HANDLE_TEST = 'process';
  const stdout = sink();
  await facts.run({
    process: processHandle({ argv: [], env: { ONLY: 'supplied' }, stdout: stdout.stream }),
  });
  expect(JSON.parse(stdout.text()).env).toEqual({ ONLY: 'supplied' });
});

test('an absolute cwd string is the working directory, read with no failure', async () => {
  vi.spyOn(process, 'cwd').mockImplementation(() => {
    throw new Error('ENOENT: uv_cwd');
  });
  const stdout = sink();
  const code = await facts.run({
    process: processHandle({ argv: [], cwd: '/srv/notes', env: {}, stdout: stdout.stream }),
  });
  expect(code).toBe(0);
  expect(JSON.parse(stdout.text()).cwd).toBe('/srv/notes');
});

test("a relative cwd string resolves against the process's working directory at each read", async () => {
  const handle = processHandle({ argv: [], cwd: 'project', env: {} });
  const read = vi.spyOn(process, 'cwd').mockReturnValue('/home/operator');
  expect(handle.cwd()).toBe('/home/operator/project');
  read.mockReturnValue('/tmp');
  expect(handle.cwd()).toBe('/tmp/project');
});

test("a relative cwd string fails the run when the process's working directory cannot be read", async () => {
  vi.spyOn(process, 'cwd').mockImplementation(() => {
    throw new Error('ENOENT: uv_cwd');
  });
  const stderr = sink();
  const code = await facts.run({
    process: processHandle({ argv: [], cwd: 'project', env: {}, stderr: stderr.stream }),
  });
  expect(code).toBe(1);
  expect(stderr.text()).toBe(
    'notes: The current working directory cannot be read. Change to a directory that exists and run the command again.\n',
  );
});

test('a cwd function that throws fails run() and app.invoke with WorkingDirectoryError', async () => {
  const removed = new Error('ENOENT: uv_cwd');
  const cwd = () => {
    throw removed;
  };
  const stderr = sink();
  const code = await facts.run({
    process: processHandle({ argv: [], cwd, env: {}, stderr: stderr.stream }),
  });
  expect(code).toBe(1);
  expect(stderr.text()).toContain('The current working directory cannot be read.');
  const outcome = await facts.invoke([], {}, { process: processHandle({ cwd, env: {} }) });
  expect(outcome).toMatchObject({ exitCode: 1, status: 'failed' });
  const failure = outcome.status === 'failed' ? outcome.failure : undefined;
  expect(failure).toBeInstanceOf(WorkingDirectoryError);
  expect(failure?.cause).toBe(removed);
});

test('a handle reused across runs reads the process facts it was not given when each run reads them', async () => {
  const stdout = sink();
  const handle = processHandle({ stdout: stdout.stream });
  process.argv = [process.execPath, 'notes.js', 'first'];
  process.env.LOOM_HANDLE_TEST = 'one';
  const app = new Application('notes')
    .argument('word', { required: true })
    .action(({ args, host, out }) =>
      out.print(`${args.word} ${String(host.env.LOOM_HANDLE_TEST)}`),
    );
  await app.run({ process: handle });
  process.argv = [process.execPath, 'notes.js', 'second'];
  process.env.LOOM_HANDLE_TEST = 'two';
  await app.run({ process: handle });
  expect(stdout.text()).toBe('first one\nsecond two\n');
});

test('run() writes its code to a hand-built handle and never to process.exitCode', async () => {
  process.exitCode = 0;
  const { handle } = handBuilt({ argv: ['--nope'] });
  const code = await facts.run({ process: handle });
  expect(code).toBe(2);
  expect(handle.exitCode).toBe(2);
  expect(process.exitCode).toBe(0);
});

test("processHandle's exitCode writes process.exitCode", async () => {
  const handle = processHandle({ argv: ['--nope'], env: {}, stderr: sink().stream });
  await facts.run({ process: handle });
  expect(handle.exitCode).toBe(2);
  expect(process.exitCode).toBe(2);
});

test('app.invoke reads env, cwd, platform, and release from its handle and writes no exitCode', async () => {
  const written: (ExitCode | undefined)[] = [];
  const { handle } = handBuilt({
    cwd: () => '/srv/notes',
    env: { ONLY: 'handle' },
    platform: 'darwin',
    release: { build: 'development' },
  });
  const recording = Object.create(handle, {
    exitCode: {
      get: () => undefined,
      set: (code: ExitCode | undefined) => {
        written.push(code);
      },
    },
  });
  const outcome = await facts.invoke([], {}, { process: recording });
  expect(outcome.status).toBe('completed');
  const output = outcome.status === 'completed' ? outcome.output : '{}';
  expect(JSON.parse(output)).toMatchObject({
    cwd: '/srv/notes',
    env: { ONLY: 'handle' },
    platform: 'darwin',
    release: { build: 'development' },
  });
  expect(written).toEqual([]);
});

test('a run reads the handle libc only when its code reads host.libc, and then once', async () => {
  let reads = 0;
  const counting = () =>
    Object.create(handBuilt().handle, {
      libc: {
        get: () => {
          reads += 1;
          return 'glibc';
        },
      },
    });
  const quiet = new Application('notes').action(({ out }) => out.print('done'));
  await quiet.run({ process: counting() });
  await quiet.invoke([], {}, { process: counting() });
  expect(reads).toBe(0);
  const seen: Host['libc'][] = [];
  const reading = new Application('notes').action(({ host }) => {
    seen.push(host.libc, host.libc);
  });
  await reading.run({ process: counting() });
  expect(reads).toBe(1);
  await reading.invoke([], {}, { process: counting() });
  expect(reads).toBe(2);
  expect(seen).toEqual(['glibc', 'glibc', 'glibc', 'glibc']);
});

test('the host copies arch, libc, and uid from the handle, in run() and app.invoke alike', async () => {
  const read: Pick<Host, 'arch' | 'libc' | 'uid'>[] = [];
  const app = new Application('notes').action(({ host }) => {
    read.push({ arch: host.arch, libc: host.libc, uid: host.uid });
  });
  const { handle } = handBuilt({ arch: 'riscv64', libc: 'glibc', uid: 0 });
  await app.run({ process: handle });
  await app.invoke([], {}, { process: handle });
  const bare = handBuilt({ libc: undefined, uid: undefined }).handle;
  await app.run({ process: bare });
  expect(read).toEqual([
    { arch: 'riscv64', libc: 'glibc', uid: 0 },
    { arch: 'riscv64', libc: 'glibc', uid: 0 },
    { arch: 'arm64', libc: undefined, uid: undefined },
  ]);
});

test("processHandle reads the process's own architecture and user unless it was given them", async () => {
  expect(processHandle().arch).toBe(process.arch);
  expect(processHandle().uid).toBe(process.getuid?.());
  expect(processHandle({ arch: 'arm64', uid: undefined })).toMatchObject({
    arch: 'arm64',
    uid: undefined,
  });
  expect(['glibc', 'musl', undefined]).toContain(processHandle().libc);
  expect(processHandle({ libc: 'musl' }).libc).toBe('musl');
});

/** The answers and raises of `host.raise` in one run on a handle. */
async function raiseIn(handle: ProcessHandle): Promise<boolean[]> {
  const answers: boolean[] = [];
  await new Application('keys')
    .action(({ host }) => {
      answers.push(host.raise('SIGINT'), host.raise('SIGTSTP'));
    })
    .run({ process: handle });
  return answers;
}

test("host.raise raises nothing and answers false when stdin is not the source's terminal", async () => {
  const { raised, source } = ownSource(new Readable({ read: () => undefined }));
  const { handle } = handBuilt({ signals: source });
  await expect(raiseIn(handle)).resolves.toEqual([false, false]);
  expect(raised).toEqual([]);
});

test("host.raise raises on the source and answers true when stdin is the source's terminal", async () => {
  const stdin = new Readable({ read: () => undefined });
  const { raised, source } = ownSource(stdin);
  const { handle } = handBuilt({ signals: source, stdin });
  await expect(raiseIn(handle)).resolves.toEqual([true, true]);
  expect(raised).toEqual(['SIGINT', 'SIGTSTP']);
});

test("every handle processHandle builds shares the real process's one signal source", () => {
  const first = processHandle().signals;
  expect(processHandle({ argv: ['other'] }).signals).toBe(first);
  // Every copy of core finds it on the one global object for the real process.
  const lane: unknown = Reflect.get(globalThis, Symbol.for('loomcli.processLane'));
  expect(lane).toMatchObject({ source: first });
});

test('processHandle has publishEnv only when it was given neither env nor cwd', () => {
  expect(processHandle().publishEnv).toBeTypeOf('function');
  expect(processHandle({ argv: [], stdout: sink().stream }).publishEnv).toBeTypeOf('function');
  expect(processHandle({ env: {} }).publishEnv).toBeUndefined();
  expect(processHandle({ cwd: '/work' }).publishEnv).toBeUndefined();
});

test("core's lane listens on the handle's source and re-raises there at a second signal", async () => {
  const { listeners, off, on, raised, source } = ownSource();
  const { handle } = handBuilt({ signals: source });
  const app = new Application('notes').action(({ signal }) => {
    expect(on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    listeners.get('SIGINT')?.();
    expect(signal.aborted).toBe(true);
    listeners.get('SIGINT')?.();
  });
  const code = await app.run({ process: handle });
  expect(code).toBe(130);
  expect(raised).toEqual(['SIGINT']);
  expect(off).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  expect(listeners.size).toBe(0);
});
