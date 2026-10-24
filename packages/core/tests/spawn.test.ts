/**
 * The child programs a run starts through `host.spawn`, under ADR-0107 and
 * docs/core/host.md#child-programs. The real handle's cases start the test's own runtime as the
 * child, so they hold under Node and Bun.
 *
 * - What core passes the handle. Core fills `cwd`, a relative one resolved against `host.cwd`, and
 *   `env`, `host.env` with what environment preparation added, or a supplied map whole. It passes
 *   `inherit` only for a run stream that is the handle's own: an argv run's, and under `app.invoke`
 *   and an action's `invoke` the run's capture sink as a `Writable`, and no stdin at all.
 * - The real handle. A captured stream answers its bytes and their UTF-8 text, an ignored stream
 *   nothing, a `Writable` receives the bytes, and `inherit` of a stream that is not the process's
 *   pipes into the handle's stream. `input` is the child's whole stdin, and no input an ended one.
 *   An abort of `signal` ends the child with SIGTERM, `kill` delivers a signal, and the code of a
 *   child a signal ended is 128 plus its number. A command no program answers to is `unstarted`,
 *   and `spawn` never throws. A detached child runs in a process group of its own.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import { afterEach, expect, test, vi } from 'vite-plus/test';

import { Application, Command, plugin, processHandle } from '../src/index.js';
import type { Child, ChildExit, Host, ProcessHandle, SpawnOptions } from '../src/index.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A stream that keeps the bytes written to it. */
function sink(): { stream: Writable; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}

/** The test's own runtime, run as the child with one script. */
const runtime = process.execPath;

/** The words that run a script in the test's runtime. */
function script(source: string): string[] {
  return ['-e', source];
}

/** Spawn options without the place core fills, each branch of the union kept apart. */
type Unplaced<Options> = Options extends unknown ? Omit<Options, 'cwd' | 'env'> : never;

/** The real handle's spawn with the place filled, as core calls it. */
function startReal(args: readonly string[], options: Unplaced<SpawnOptions> = {}): Child {
  const handle = processHandle({ env: { PATH: process.env.PATH } });
  return handle.spawn(runtime, args, {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
    ...options,
  });
}

/** The exit of a child that exited, failing the test for one that never started. */
async function exitOf(child: Child): Promise<Extract<ChildExit, { kind: 'exited' }>> {
  const exit = await child.exited;
  if (exit.kind !== 'exited') {
    throw exit.error;
  }
  return exit;
}

/** A hand-built handle whose spawn records what core passes it and answers an exit of 0. */
function recordingHandle(fields: Partial<ProcessHandle> = {}) {
  const calls: {
    command: string;
    args: readonly string[];
    options: Parameters<ProcessHandle['spawn']>[2];
  }[] = [];
  const stdout = sink();
  const stderr = sink();
  const stdin = Readable.from([]);
  const empty = { bytes: new Uint8Array(), text: '' };
  const handle: ProcessHandle = {
    arch: 'x64',
    argv: [],
    cwd: () => '/work',
    env: { PATH: '/bin' },
    exitCode: undefined,
    home: '/home/me',
    libc: 'glibc',
    platform: 'linux',
    program: ['/bin/notes'],
    release: { build: 'source' },
    signals: {
      off: () => undefined,
      on: () => undefined,
      raise: () => undefined,
      terminal: undefined,
    },
    spawn: (command, args, options) => {
      calls.push({ args, command, options });
      return {
        exited: Promise.resolve({ code: 0, kind: 'exited', stderr: empty, stdout: empty }),
        kill: () => undefined,
      };
    },
    stderr: stderr.stream,
    stdin,
    stdout: stdout.stream,
    terminal: {
      stderr: { columns: undefined, isTTY: false, rows: undefined },
      stdin: { isTTY: false },
      stdout: { columns: undefined, isTTY: false, rows: undefined },
    },
    timeZone: 'UTC',
    tmpdir: '/tmp',
    uid: 1000,
    ...fields,
  };
  return { calls, handle, stderr, stdin, stdout };
}

/** An application whose root action starts one child through the host with the options given. */
function starting(options: SpawnOptions, words: readonly string[] = []) {
  return new Application('notes').action(async ({ host }) => {
    await host.spawn('git', words, options).exited;
  });
}

test('core fills cwd and env from the run, resolving a relative cwd against host.cwd', async () => {
  const { calls, handle } = recordingHandle();
  await starting({}).run({ process: handle });
  await starting({ cwd: 'notes' }).run({ process: handle });
  await starting({ cwd: '/srv', env: { ONLY: 'given' } }).run({ process: handle });
  expect(calls.map(({ options }) => [options.cwd, options.env])).toEqual([
    ['/work', { PATH: '/bin' }],
    ['/work/notes', { PATH: '/bin' }],
    ['/srv', { ONLY: 'given' }],
  ]);
});

test('the env core fills holds what environment preparation added', async () => {
  const { calls, handle } = recordingHandle();
  const dotenv = plugin('@fixture/dotenv', { onEnvironment: () => ({ ADDED: 'by-dotenv' }) });
  const app = new Application('notes', { plugins: [dotenv] }).action(async ({ host }) => {
    await host.spawn('git', ['status']).exited;
  });
  await app.run({ process: handle });
  expect(calls[0]?.options.env).toEqual({ ADDED: 'by-dotenv', PATH: '/bin' });
});

test("an argv run passes inherit for each stream that is the handle's own", async () => {
  const { calls, handle } = recordingHandle();
  await starting({ stderr: 'inherit', stdin: 'inherit', stdout: 'inherit' }).run({
    process: handle,
  });
  expect(calls[0]?.options).toMatchObject({
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  });
});

test('app.invoke passes its capture sinks as Writables in place of inherit, and no stdin', async () => {
  const { calls, handle } = recordingHandle();
  const outcome = await starting({ stderr: 'inherit', stdin: 'inherit', stdout: 'inherit' }).invoke(
    [],
    {},
    { process: handle },
  );
  expect(outcome.status).toBe('completed');
  const options = calls[0]?.options;
  expect(options).toBeDefined();
  expect(options).not.toHaveProperty('stdin');
  expect(options).not.toHaveProperty('input');
  expect(options && 'stdout' in options && options.stdout).toBeInstanceOf(Writable);
  expect(options && 'stderr' in options && options.stderr).toBeInstanceOf(Writable);
});

test("an action's invoke passes Writables to its run's handle in place of inherit", async () => {
  const { calls, handle } = recordingHandle();
  const app = new Application('notes')
    .command(
      new Command('child', { description: 'Start git.' }).action(async ({ host }) => {
        await host.spawn('git', [], { stdin: 'inherit', stdout: 'inherit' }).exited;
      }),
    )
    .command(
      new Command('outer', { description: 'Invoke child.' }).action(async ({ invoke }) => {
        await invoke(['child'], {});
      }),
    );
  await app.run({ process: { ...handle, argv: ['outer'] } });
  const options = calls[0]?.options;
  expect(options).toMatchObject({ cwd: '/work', env: { PATH: '/bin' } });
  expect(options && 'stdout' in options && options.stdout).toBeInstanceOf(Writable);
  expect(options).not.toHaveProperty('stdin');
});

test('a detached spawn reaches the handle with its place and nothing else', async () => {
  const { calls, handle } = recordingHandle();
  await starting({ detached: true }).run({ process: handle });
  expect(calls[0]?.options).toEqual({ cwd: '/work', detached: true, env: { PATH: '/bin' } });
});

test('a captured stream answers the bytes the child wrote and their UTF-8 text', async () => {
  const exit = await exitOf(
    startReal(
      script(
        "process.stdout.write(Buffer.from([0x68, 0xc3, 0xa9, 0xff])); process.stderr.write('warned');",
      ),
    ),
  );
  expect(exit.code).toBe(0);
  expect([...exit.stdout.bytes]).toEqual([0x68, 0xc3, 0xa9, 0xff]);
  expect(exit.stdout.text).toBe('hé�');
  expect(exit.stderr.text).toBe('warned');
});

test('an ignored stream answers nothing, and a Writable receives the bytes as the child writes them', async () => {
  const received = sink();
  const exit = await exitOf(
    startReal(script("process.stdout.write('out'); process.stderr.write('err');"), {
      stderr: received.stream,
      stdout: 'ignore',
    }),
  );
  expect(exit.stdout.bytes).toHaveLength(0);
  expect(exit.stderr.text).toBe('');
  expect(received.text()).toBe('err');
});

test("inherit of a stream that is not the process's pipes into the handle's stream", async () => {
  const stdout = sink();
  const handle = processHandle({ stdout: stdout.stream });
  const exit = await exitOf(
    handle.spawn(runtime, script("process.stdout.write('through');"), {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH },
      stdout: 'inherit',
    }),
  );
  expect(exit.stdout.text).toBe('');
  expect(stdout.text()).toBe('through');
});

test("stdin inherit of a stream that is not the process's pipes the handle's stdin into the child", async () => {
  const handle = processHandle({ stdin: Readable.from([Buffer.from('typed')]) });
  const exit = await exitOf(
    handle.spawn(runtime, script('process.stdin.pipe(process.stdout);'), {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH },
      stdin: 'inherit',
    }),
  );
  expect(exit.stdout.text).toBe('typed');
});

test("input is the child's whole stdin, text or bytes, and no input is an ended stdin", async () => {
  const echo = script('process.stdin.pipe(process.stdout);');
  const text = await exitOf(startReal(echo, { input: 'piped text' }));
  const bytes = await exitOf(startReal(echo, { input: new Uint8Array([1, 2, 3]) }));
  const none = await exitOf(startReal(echo));
  expect(text.stdout.text).toBe('piped text');
  expect([...bytes.stdout.bytes]).toEqual([1, 2, 3]);
  expect(none.stdout.text).toBe('');
});

test('the exit code is the code the child exited with', async () => {
  const exit = await exitOf(startReal(script('process.exit(3);')));
  expect(exit.code).toBe(3);
});

test('an abort of signal ends the child with SIGTERM, 128 plus its number', async () => {
  const controller = new AbortController();
  const child = startReal(
    script("setTimeout(() => undefined, 30_000); process.stdout.write('up');"),
    {
      signal: controller.signal,
    },
  );
  setTimeout(() => controller.abort(), 200);
  await expect(exitOf(child)).resolves.toMatchObject({ code: 143 });
});

test('a signal already aborted ends the child as soon as it starts', async () => {
  const child = startReal(script('setTimeout(() => undefined, 30_000);'), {
    signal: AbortSignal.abort(),
  });
  await expect(exitOf(child)).resolves.toMatchObject({ code: 143 });
});

test('kill delivers the signal it names, and the code is 128 plus its number', async () => {
  const child = startReal(script('setTimeout(() => undefined, 30_000);'));
  setTimeout(() => child.kill('SIGHUP'), 200);
  await expect(exitOf(child)).resolves.toMatchObject({ code: 129 });
  child.kill();
});

test('kill of SIGKILL ends a child that ignores SIGTERM, with the code 137', async () => {
  const child = startReal(
    script("process.on('SIGTERM', () => undefined); setTimeout(() => undefined, 30_000);"),
  );
  setTimeout(() => {
    child.kill('SIGTERM');
    child.kill('SIGKILL');
  }, 200);
  await expect(exitOf(child)).resolves.toMatchObject({ code: 137 });
});

test('a command no program answers to is unstarted with the runtime error, and spawn does not throw', async () => {
  const handle = processHandle();
  const missing = handle.spawn('loom-test-no-such-program', [], {
    cwd: process.cwd(),
    env: { PATH: '/nonexistent' },
  });
  const exit = await missing.exited;
  expect(exit.kind).toBe('unstarted');
  expect(exit.kind === 'unstarted' && Reflect.get(exit.error, 'code')).toBe('ENOENT');
  const nowhere = handle.spawn(runtime, [], { cwd: '/loom-test/nowhere', env: {} });
  await expect(nowhere.exited).resolves.toMatchObject({ kind: 'unstarted' });
});

test('a detached child runs in a process group of its own, with every stream ignored', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loom-spawn-'));
  roots.push(root);
  const marker = join(root, 'pid');
  const child = processHandle().spawn(
    runtime,
    script(
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); process.stdout.write('lost'); setTimeout(() => undefined, 30_000);`,
    ),
    { cwd: root, detached: true, env: { PATH: process.env.PATH } },
  );
  const pid = await vi.waitFor(() => readFileSync(marker, 'utf8'), {
    interval: 50,
    timeout: 10_000,
  });
  const group = execFileSync('ps', ['-o', 'pgid=', '-p', pid], { encoding: 'utf8' }).trim();
  expect(group).toBe(pid);
  child.kill('SIGTERM');
  const exit = await exitOf(child);
  expect(exit.code).toBe(143);
  expect(exit.stdout.bytes).toHaveLength(0);
});

test('host.spawn starts a real child through the real handle', async () => {
  const seen: { exit?: ChildExit } = {};
  const app = new Application('notes').action(async ({ host }: { host: Host }) => {
    seen.exit = await host.spawn(
      runtime,
      script("process.stdout.write(process.cwd() + ' ' + process.env.ONLY);"),
      {
        env: { ONLY: 'given' },
      },
    ).exited;
  });
  await app.run({ process: processHandle({ argv: [], cwd: tmpdir(), env: {} }) });
  const { exit } = seen;
  expect(exit).toMatchObject({ code: 0, kind: 'exited' });
  expect(exit?.kind === 'exited' ? exit.stdout.text : '').toMatch(/ given$/u);
});
