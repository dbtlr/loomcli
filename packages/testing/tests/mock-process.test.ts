import { Writable } from 'node:stream';

import { Application, Command, plugin } from '@loomcli/core';
import type { Host, Plugin, ProcessSignal, StandardSchemaV1 } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';
import { help } from '@loomcli/plugins/help';
import { text as ask } from '@loomcli/prompts';
import { describe, expect, it, vi } from 'vite-plus/test';

import { mockProcess } from '../src/index.js';
import type { MockProcess, MockTerminal, ProgramAnswer, ProgramCall } from '../src/index.js';

/** The text a Readable yields before it ends. */
async function drained(stream: NodeJS.ReadableStream): Promise<string> {
  let text = '';
  for await (const chunk of stream) {
    text += String(chunk);
  }
  return text;
}

describe('the sealed defaults', () => {
  const defaults: readonly [string, (mock: MockProcess) => unknown, unknown][] = [
    ['argv', (mock) => mock.argv, []],
    ['env', (mock) => mock.env, {}],
    ['cwd', (mock) => mock.cwd(), '/loom-test'],
    ['home', (mock) => mock.home, '/loom-test/home'],
    ['tmpdir', (mock) => mock.tmpdir, '/loom-test/tmp'],
    ['platform', (mock) => mock.platform, 'linux'],
    ['arch', (mock) => mock.arch, 'x64'],
    ['libc', (mock) => mock.libc, 'glibc'],
    ['uid', (mock) => mock.uid, 1000],
    ['timeZone', (mock) => mock.timeZone, 'UTC'],
    ['program', (mock) => mock.program, ['/loom-test/runtime', '/loom-test/app.js']],
    ['release', (mock) => mock.release, { build: 'source' }],
    ['readSource', (mock) => mock.readSource, undefined],
    ['exitCode', (mock) => mock.exitCode, undefined],
    ['signals.terminal', (mock) => mock.signals.terminal, undefined],
    ['publishEnv', (mock) => mock.publishEnv, undefined],
    ['endedBy', (mock) => mock.endedBy, undefined],
    ['transcript', (mock) => mock.transcript, []],
    ['stdout.text', (mock) => mock.stdout.text, ''],
    ['stderr.text', (mock) => mock.stderr.text, ''],
    ['stdin terminal', (mock) => mock.terminal.stdin.isTTY, false],
    [
      'stdout terminal',
      (mock) => mock.terminal.stdout,
      { columns: undefined, isTTY: false, rows: undefined },
    ],
    [
      'stderr terminal',
      (mock) => mock.terminal.stderr,
      { columns: undefined, isTTY: false, rows: undefined },
    ],
    ['terminal background', (mock) => mock.terminal.background, undefined],
  ];

  it.each(defaults)('%s', (_name, read, expected) => {
    expect(read(mockProcess())).toEqual(expected);
  });

  it('stdin is empty and ends', async () => {
    await expect(drained(mockProcess().stdin)).resolves.toBe('');
  });

  it('libc is undefined when the platform is not linux', () => {
    expect(mockProcess({ platform: 'darwin' }).libc).toBeUndefined();
    expect(mockProcess({ libc: 'musl', platform: 'darwin' }).libc).toBe('musl');
    expect(mockProcess({ libc: undefined }).libc).toBeUndefined();
  });

  it('reads nothing from the process the test runs in', () => {
    const mock = mockProcess();
    expect(mock.env).not.toBe(process.env);
    expect(mock.cwd()).not.toBe(process.cwd());
  });
});

describe('supplied fields', () => {
  it('replace their defaults whole', () => {
    const release = { build: 'distributed' } as const;
    const mock = mockProcess({
      arch: 'arm64',
      argv: ['a', 'b'],
      cwd: '/work',
      env: { HOME: '/h' },
      platform: 'darwin',
      program: ['x'],
      release,
      timeZone: 'Asia/Tokyo',
      uid: undefined,
    });
    expect([mock.arch, mock.argv, mock.cwd(), mock.env, mock.platform, mock.program]).toEqual([
      'arm64',
      ['a', 'b'],
      '/work',
      { HOME: '/h' },
      'darwin',
      ['x'],
    ]);
    expect([mock.release, mock.timeZone, mock.uid]).toEqual([release, 'Asia/Tokyo', undefined]);
  });

  it('a supplied readSource is the reader', () => {
    const mock = mockProcess({ readSource: (path) => `source of ${path}` });
    expect(mock.readSource?.('a.ts', '/')).toBe('source of a.ts');
  });

  it('a cwd function stands in for the read and may throw', () => {
    const failing = mockProcess({
      cwd: () => {
        throw new Error('ENOENT');
      },
    });
    expect(() => failing.cwd()).toThrow('ENOENT');
    expect(mockProcess({ cwd: () => '/live' }).cwd()).toBe('/live');
  });
});

describe('folders', () => {
  it('home and tmpdir follow an absolute HOME and TMPDIR in env', () => {
    const mock = mockProcess({ env: { HOME: '/srv/home', TMPDIR: '/srv/tmp' } });
    expect([mock.home, mock.tmpdir]).toEqual(['/srv/home', '/srv/tmp']);
  });

  it.each([
    ['empty', ''],
    ['relative', 'notes'],
  ])('a HOME and TMPDIR that are %s fall back to the fixed folders', (_case, value) => {
    const mock = mockProcess({ env: { HOME: value, TMP: '/srv/tmp', TMPDIR: value } });
    expect([mock.home, mock.tmpdir]).toEqual(['/loom-test/home', '/loom-test/tmp']);
  });

  it('a supplied home and tmpdir win over env', () => {
    const mock = mockProcess({
      env: { HOME: '/srv/home', TMPDIR: '/srv/tmp' },
      home: '/home/me',
      tmpdir: '/var/tmp',
    });
    expect([mock.home, mock.tmpdir]).toEqual(['/home/me', '/var/tmp']);
  });

  it('a run reads the mock folders, and a TMPDIR environment preparation adds moves neither', async () => {
    const mock = mockProcess({ argv: [], env: { HOME: '/srv/home' } });
    const dotenv = plugin('fixture/dotenv', {
      onEnvironment: () => ({ TMPDIR: '/moved/tmp' }),
    });
    const app = new Application('app', { plugins: [dotenv] }).action(({ host, out }) =>
      out.print(`${host.home} ${host.tmpdir} ${host.env.TMPDIR ?? ''}`),
    );
    await app.run({ process: mock });
    expect(mock.stdout.text).toBe('/srv/home /loom-test/tmp /moved/tmp\n');
  });
});

/** An application whose root action starts one child and prints how it ended. */
function starting(
  command: string,
  options: Parameters<Host['spawn']>[2] = {},
  words: readonly string[] = ['status'],
) {
  return new Application('app').action(async ({ host, out }) => {
    const exit = await host.spawn(command, words, options).exited;
    await out.print(
      exit.kind === 'exited'
        ? `${exit.code} [${exit.stdout.text}] [${exit.stderr.text}]`
        : `unstarted: ${exit.error.message}`,
    );
  });
}

describe('child programs', () => {
  it('a script answers the code and the captured output, from the call core filled in', async () => {
    const calls: ProgramCall[] = [];
    const mock = mockProcess({
      cwd: '/work',
      env: { PATH: '/bin' },
      programs: {
        git: (call) => {
          calls.push(call);
          return { code: 3, stderr: new TextEncoder().encode('warned'), stdout: 'answer' };
        },
      },
    });
    await starting('git', { cwd: 'notes', input: 'typed' }).run({ process: mock });
    expect(mock.stdout.text).toBe('3 [answer] [warned]\n');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      args: ['status'],
      command: 'git',
      cwd: '/work/notes',
      detached: false,
      env: { PATH: '/bin' },
      input: 'typed',
    });
    expect(calls[0]?.signal.aborted).toBe(false);
  });

  it('an answer that omits its members exits 0 with no output', async () => {
    const mock = mockProcess({ programs: { git: () => ({}) } });
    await starting('git').run({ process: mock });
    expect(mock.stdout.text).toBe('0 [] []\n');
  });

  it('an inherited stream writes to the mock own stream, a Writable receives, and ignore drops', async () => {
    const received: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, done) {
        received.push(String(chunk));
        done();
      },
    });
    const mock = mockProcess({
      programs: { git: () => ({ stderr: 'to-writable', stdout: 'to-stdout' }) },
    });
    await starting('git', { stderr: writable, stdout: 'inherit' }).run({ process: mock });
    expect(mock.transcript[0]).toEqual({ stream: 'stdout', text: 'to-stdout' });
    expect(received).toEqual(['to-writable']);
    const ignoring = mockProcess({ programs: { git: () => ({ stderr: 'e', stdout: 'o' }) } });
    await starting('git', { stderr: 'ignore', stdout: 'ignore' }).run({ process: ignoring });
    expect(ignoring.stdout.text).toBe('0 [] []\n');
  });

  it("under stdin: 'inherit' the call's input is the mock stdin text", async () => {
    const inputs: string[] = [];
    const mock = mockProcess({
      programs: {
        cat: ({ input }) => {
          inputs.push(input);
          return {};
        },
      },
      stdin: 'piped',
    });
    await starting('cat', { stdin: 'inherit' }).run({ process: mock });
    await starting('cat').run({ process: mock });
    expect(inputs).toEqual(['piped', '']);
  });

  it("under stdin: 'inherit' byte stdin is the call's input decoded as UTF-8", async () => {
    const inputs: string[] = [];
    const mock = mockProcess({
      programs: {
        cat: ({ input }) => {
          inputs.push(input);
          return {};
        },
      },
      stdin: new TextEncoder().encode('caf\u00e9'),
    });
    await starting('cat', { stdin: 'inherit' }).run({ process: mock });
    expect(inputs).toEqual(['caf\u00e9']);
  });

  it('under app.invoke an inherited stream reaches the outcome, not the mock', async () => {
    const mock = mockProcess({ programs: { git: () => ({ stdout: 'through' }) } });
    const outcome = await starting('git', { stdout: 'inherit' }).invoke([], {}, { process: mock });
    expect(outcome).toMatchObject({ output: 'through0 [] []\n', status: 'completed' });
    expect(mock.transcript).toEqual([]);
  });

  it('a command with no script throws from spawn, naming the command, so the run fails', async () => {
    const mock = mockProcess({ programs: { '/usr/bin/git': () => ({}) } });
    expect(() => mock.spawn('git', [], { cwd: '/', env: {} })).toThrow(
      'mockProcess has no program for "git". Add a "git" entry to programs.',
    );
    const code = await starting('git').run({ process: mock });
    expect(code).toBe(1);
    expect(mock.stderr.text).toContain('mockProcess has no program for "git".');
  });

  it('a script that throws is a program that could not start', async () => {
    const mock = mockProcess({
      programs: {
        git: () => {
          throw new Error('spawn git ENOENT');
        },
      },
    });
    await starting('git').run({ process: mock });
    expect(mock.stdout.text).toBe('unstarted: spawn git ENOENT\n');
  });

  it('exited resolves after the script answers, never before spawn returns', async () => {
    const order: string[] = [];
    const mock = mockProcess({
      programs: {
        git: () => {
          order.push('script');
          return {};
        },
      },
    });
    const child = mock.spawn('git', [], { cwd: '/', env: {} });
    order.push('returned');
    await child.exited;
    expect(order).toEqual(['returned', 'script']);
  });

  it('an abort of the spawn signal ends the child with SIGTERM, and the call signal aborts', async () => {
    const controller = new AbortController();
    const seen: { call?: ProgramCall } = {};
    const mock = mockProcess({
      programs: {
        sleep: (received) => {
          seen.call = received;
          return new Promise(() => undefined);
        },
      },
    });
    const child = mock.spawn('sleep', [], { cwd: '/', env: {}, signal: controller.signal });
    await vi.waitFor(() => expect(seen.call).toBeDefined());
    controller.abort();
    await expect(child.exited).resolves.toMatchObject({ code: 143, kind: 'exited' });
    expect(seen.call?.signal.aborted).toBe(true);
  });

  it('a kill of an ending signal ends the child with 128 plus its number, whatever the script answers later', async () => {
    const pending: { answer?: (value: ProgramAnswer) => void } = {};
    const mock = mockProcess({
      programs: {
        sleep: () =>
          new Promise<ProgramAnswer>((resolve) => {
            pending.answer = resolve;
          }),
      },
    });
    const ended: [ProcessSignal | 'SIGKILL', number][] = [
      ['SIGHUP', 129],
      ['SIGINT', 130],
      ['SIGKILL', 137],
      ['SIGQUIT', 131],
      ['SIGTERM', 143],
    ];
    for (const [signal, code] of ended) {
      const child = mock.spawn('sleep', [], { cwd: '/', env: {} });
      await Promise.resolve();
      child.kill(signal);
      pending.answer?.({ code: 0, stdout: 'late' });
      await expect(child.exited).resolves.toEqual({
        code,
        kind: 'exited',
        stderr: { bytes: new Uint8Array(), text: '' },
        stdout: { bytes: new Uint8Array(), text: '' },
      });
    }
  });

  it('a kill of SIGTSTP or SIGCONT aborts nothing and does not end the child', async () => {
    const seen: { call?: ProgramCall } = {};
    const mock = mockProcess({
      programs: {
        sleep: async (received) => {
          seen.call = received;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { code: 0, stdout: 'done' };
        },
      },
    });
    const child = mock.spawn('sleep', [], { cwd: '/', env: {} });
    child.kill('SIGTSTP');
    child.kill('SIGCONT');
    await expect(child.exited).resolves.toMatchObject({ code: 0, stdout: { text: 'done' } });
    expect(seen.call?.signal.aborted).toBe(false);
  });

  it('a kill once the child has exited does nothing', async () => {
    const mock = mockProcess({ programs: { git: () => ({ code: 0 }) } });
    const child = mock.spawn('git', [], { cwd: '/', env: {} });
    await child.exited;
    child.kill();
    await expect(child.exited).resolves.toMatchObject({ code: 0 });
  });

  it('a detached child is a call with detached set and no input, and its output is ignored', async () => {
    const calls: ProgramCall[] = [];
    const mock = mockProcess({
      programs: {
        notes: (call) => {
          calls.push(call);
          return { stdout: 'lost' };
        },
      },
      stdin: 'unread',
    });
    const child = mock.spawn('notes', ['refresh'], { cwd: '/cache', detached: true, env: {} });
    await expect(child.exited).resolves.toMatchObject({ code: 0, stdout: { text: '' } });
    expect(calls[0]).toMatchObject({ args: ['refresh'], cwd: '/cache', detached: true, input: '' });
    expect(mock.transcript).toEqual([]);
  });
});

describe('piped stdin', () => {
  it('yields bytes that are not valid UTF-8 exactly as given, as one chunk', async () => {
    const bytes = Uint8Array.of(0xff, 0xfe, 0x00, 0xc3, 0x28);
    const chunks: Uint8Array[] = [];
    for await (const chunk of mockProcess({ stdin: bytes }).stdin) {
      chunks.push(Uint8Array.from(Buffer.from(chunk)));
    }
    expect(chunks).toEqual([bytes]);
  });

  it('yields nothing for empty bytes', async () => {
    await expect(drained(mockProcess({ stdin: new Uint8Array() }).stdin)).resolves.toBe('');
  });

  it('yields the text once over the mock life, then ends', async () => {
    const mock = mockProcess({ stdin: 'hello\n' });
    await expect(drained(mock.stdin)).resolves.toBe('hello\n');
    await expect(drained(mock.stdin)).resolves.toBe('');
  });

  it('is never a terminal, even beside a terminal', () => {
    const mock = mockProcess({ stdin: 'x', terminal: { columns: 80, rows: 24 } });
    expect(mock.terminal.stdin.isTTY).toBe(false);
  });
});

describe('the terminal', () => {
  it('puts stdout and stderr on a terminal with the given size by default', () => {
    const { terminal } = mockProcess({ terminal: { columns: 80, rows: 24 } });
    expect(terminal.stdout).toEqual({ columns: 80, isTTY: true, rows: 24 });
    expect(terminal.stderr).toEqual({ columns: 80, isTTY: true, rows: 24 });
  });

  it('puts only the named streams on the terminal', () => {
    const { terminal } = mockProcess({ terminal: { columns: 80, rows: 24, streams: ['stderr'] } });
    expect(terminal.stdout).toEqual({ columns: undefined, isTTY: false, rows: undefined });
    expect(terminal.stderr.isTTY).toBe(true);
  });

  it('resize changes what the next read returns', () => {
    const mock = mockProcess({ terminal: { columns: 80, rows: 24 } });
    const before = mock.terminal.stdout.columns;
    mock.resize(40, 10);
    expect([before, mock.terminal.stdout.columns, mock.terminal.stderr.rows]).toEqual([80, 40, 10]);
  });

  it('resize reports no size on a mock without a terminal', () => {
    const mock = mockProcess();
    mock.resize(40, 10);
    expect(mock.terminal.stdout.columns).toBeUndefined();
  });

  it('a stated background is on the terminal', () => {
    const mock = mockProcess({
      terminal: {
        background: 'dark',
        columns: 1,
        rows: 1,
      },
    });
    expect(mock.terminal.background).toBe('dark');
  });
});

describe('recording', () => {
  it('decodes UTF-8 split across writes', () => {
    const mock = mockProcess();
    const bytes = Buffer.from('é');
    mock.stdout.write(bytes.subarray(0, 1));
    mock.stdout.write(bytes.subarray(1));
    expect(mock.stdout.text).toBe('é');
  });

  it('end flushes a character the last write left incomplete', async () => {
    const mock = mockProcess();
    const bytes = Buffer.from('aé');
    mock.stdout.write(bytes.subarray(0, 2));
    expect(mock.stdout.text).toBe('a');
    await new Promise<void>((resolve) => mock.stdout.end(resolve));
    expect(mock.stdout.text).toBe('a\uFFFD');
    expect(mock.transcript.map(({ text }) => text)).toEqual(['a', '\uFFFD']);
  });

  it('keeps each write in order, tagged by stream', () => {
    const mock = mockProcess();
    mock.stdout.write('a');
    mock.stderr.write('b');
    mock.stdout.write('c');
    expect(mock.transcript).toEqual([
      { stream: 'stdout', text: 'a' },
      { stream: 'stderr', text: 'b' },
      { stream: 'stdout', text: 'c' },
    ]);
    expect([mock.stdout.text, mock.stderr.text]).toEqual(['ac', 'b']);
  });

  it('records the exit code written to it', () => {
    const mock = mockProcess();
    mock.exitCode = 2;
    expect(mock.exitCode).toBe(2);
  });
});

describe('signals', () => {
  const listenable: readonly ProcessSignal[] = [
    'SIGHUP',
    'SIGINT',
    'SIGQUIT',
    'SIGTERM',
    'SIGTSTP',
    'SIGCONT',
  ];

  it.each(listenable)('raise(%s) reaches its listener synchronously and only its own', (signal) => {
    const mock = mockProcess();
    const heard: string[] = [];
    mock.signals.on(signal, () => heard.push(signal));
    for (const other of listenable.filter((entry) => entry !== signal)) {
      mock.signals.on(other, () => heard.push(other));
    }
    mock.signals.raise(signal);
    expect(heard).toEqual([signal]);
    expect(mock.endedBy).toBeUndefined();
  });

  it('a listener added during a raise runs on the next raise, not this one', () => {
    const mock = mockProcess();
    const heard: string[] = [];
    mock.signals.on('SIGINT', () => {
      heard.push('first');
      mock.signals.on('SIGINT', () => heard.push('added'));
    });
    mock.signals.raise('SIGINT');
    expect(heard).toEqual(['first']);
    mock.signals.raise('SIGINT');
    expect(heard).toEqual(['first', 'first', 'added']);
  });

  it('off removes a listener, so the signal then finds none', () => {
    const mock = mockProcess();
    const heard: number[] = [];
    const listener = () => heard.push(1);
    mock.signals.on('SIGTERM', listener);
    mock.signals.off('SIGTERM', listener);
    mock.signals.raise('SIGTERM');
    expect(heard).toEqual([]);
    expect(mock.endedBy).toBe('SIGTERM');
  });

  it('accepts exit listeners without calling them on a signal', () => {
    const mock = mockProcess();
    let called = false;
    const listener = () => {
      called = true;
    };
    mock.signals.on('exit', listener);
    mock.signals.on('SIGINT', () => undefined);
    mock.signals.raise('SIGINT');
    mock.signals.off('exit', listener);
    expect(called).toBe(false);
  });

  it.each(['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM'] as const)(
    'an unheard %s ends the mock, and nothing later is delivered or recorded',
    (signal) => {
      const mock = mockProcess();
      mock.stdout.write('before');
      mock.exitCode = 0;
      mock.signals.raise(signal);
      const heard: string[] = [];
      mock.signals.on('SIGTERM', () => heard.push('late'));
      mock.signals.raise('SIGTERM');
      mock.stdout.write('after');
      mock.stderr.write('after');
      mock.exitCode = 1;
      expect(mock.endedBy).toBe(signal);
      expect(heard).toEqual([]);
      expect([mock.stdout.text, mock.stderr.text, mock.exitCode]).toEqual(['before', '', 0]);
      expect(mock.transcript).toEqual([{ stream: 'stdout', text: 'before' }]);
    },
  );

  it.each(['SIGTSTP', 'SIGCONT'] as const)('an unheard %s does nothing', (signal) => {
    const mock = mockProcess();
    mock.signals.raise(signal);
    mock.stdout.write('still');
    expect([mock.endedBy, mock.stdout.text]).toEqual([undefined, 'still']);
  });

  it('two mocks share no signals', () => {
    const one = mockProcess();
    const two = mockProcess();
    let heard = false;
    one.signals.on('SIGINT', () => {
      heard = true;
    });
    two.signals.raise('SIGINT');
    expect(heard).toBe(false);
    expect(two.endedBy).toBe('SIGINT');
  });
});

const longDescription = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi';

/** An application whose root prints the facts a run reads, and one Command that needs an argument. */
function application() {
  return new Application('app', { description: longDescription, plugins: [help()] })
    .command(
      new Command('need').argument('name', { required: true }).action(({ out }) => out.print('x')),
    )
    .command(
      new Command('width').action(({ host, out }) =>
        out.print(`columns:${String(host.terminal.stdout.columns)}`),
      ),
    )
    .command(
      new Command('facts').action(({ host, out }) =>
        out.print(
          JSON.stringify({ cwd: host.cwd, env: host.env, platform: host.platform, uid: host.uid }),
        ),
      ),
    )
    .action(({ out }) => out.print('hello'));
}

describe('a run on a mock', () => {
  it('prints to stdout and sets the exit code', async () => {
    const mock = mockProcess();
    const code = await application().run({ process: mock });
    expect([code, mock.exitCode, mock.stdout.text, mock.stderr.text]).toEqual([
      0,
      0,
      'hello\n',
      '',
    ]);
  });

  it('writes a usage error to stderr with exit 2', async () => {
    const mock = mockProcess({ argv: ['need'] });
    const code = await application().run({ process: mock });
    expect(code).toBe(2);
    expect(mock.exitCode).toBe(2);
    expect(mock.stdout.text).toBe('');
    expect(mock.stderr.text).toContain('app:');
  });

  it('reads the mock facts and not the real process', async () => {
    process.env.LOOM_MOCK_LEAK = 'leaked';
    try {
      const mock = mockProcess({ argv: ['facts'], cwd: '/work', env: { HOME: '/home' } });
      await application().run({ process: mock });
      expect(JSON.parse(mock.stdout.text)).toEqual({
        cwd: '/work',
        env: { HOME: '/home' },
        platform: 'linux',
        uid: 1000,
      });
    } finally {
      delete process.env.LOOM_MOCK_LEAK;
    }
  });

  it('the terminal width reaches the run and a resize changes the next one', async () => {
    const mock = mockProcess({ argv: ['width'], terminal: { columns: 70, rows: 20 } });
    await application().run({ process: mock });
    mock.resize(50, 20);
    await application().run({ process: mock });
    expect(mock.stdout.text).toBe('columns:70\ncolumns:50\n');
  });

  it('with no terminal the width is undefined', async () => {
    const mock = mockProcess({ argv: ['width'] });
    await application().run({ process: mock });
    expect(mock.stdout.text).toBe('columns:undefined\n');
  });

  it('wraps a line to the terminal width', async () => {
    const wide = mockProcess({ argv: ['--help'], terminal: { columns: 100, rows: 20 } });
    const narrow = mockProcess({ argv: ['--help'], terminal: { columns: 20, rows: 20 } });
    await application().run({ process: wide });
    await application().run({ process: narrow });
    const wideLines = wide.stdout.text.split('\n').filter((line) => line.includes('alpha'));
    expect(wideLines).toEqual([expect.stringContaining('xi')]);
    const narrowLines = narrow.stdout.text.split('\n');
    expect(narrowLines.some((line) => line.includes('alpha') && !line.includes('xi'))).toBe(true);
  });

  it('records several runs in order', async () => {
    const mock = mockProcess();
    await application().run({ process: mock });
    await application().run({ process: mock });
    expect(mock.stdout.text).toBe('hello\nhello\n');
    expect(mock.transcript).toHaveLength(2);
  });

  it('an invocation by name reads the mock facts and records nothing on it', async () => {
    const mock = mockProcess({ cwd: '/named', env: { HOME: '/named-home' } });
    const outcome = await application().invoke(['facts'], {}, { process: mock });
    if (outcome.status !== 'completed') {
      throw new Error(`The invocation ${outcome.status}.`);
    }
    expect(JSON.parse(outcome.output)).toMatchObject({
      cwd: '/named',
      env: { HOME: '/named-home' },
    });
    expect([mock.stdout.text, mock.stderr.text, mock.exitCode, mock.transcript]).toEqual([
      '',
      '',
      undefined,
      [],
    ]);
  });

  it('a signal raised during a run cancels it, the run resolves 130, and the re-raise ends the mock', async () => {
    const mock = mockProcess();
    const app = new Application('app').action(async ({ signal }) => {
      const aborted = new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve());
      });
      mock.signals.raise('SIGINT');
      await aborted;
    });
    const code = await app.run({ process: mock });
    expect([code, mock.exitCode, mock.endedBy]).toEqual([130, 130, undefined]);
    // The shutdown ends on the next turn once the run resolved, and re-raises on the mock's source.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(mock.endedBy).toBe('SIGINT');
  });
});

/** A validator that accepts digits alone, as a port question does. */
const digits: StandardSchemaV1<string, number> = {
  '~standard': {
    validate: (value: unknown) =>
      typeof value === 'string' && /^\d+$/u.test(value)
        ? { value: Number(value) }
        : { issues: [{ message: 'Supply a number.' }] },
    vendor: 'test',
    version: 1,
  },
};

/** An application that asks for a port and then a name, and prints both. */
function setup(plugins: Plugin[] = []) {
  return new Application('setup', { plugins }).action(async (context) => {
    const port = await ask(context, { message: 'Port', validate: digits });
    const name = await ask(context, { message: 'Name' });
    await context.out.print(`Saved ${String(port)} for ${name}.`);
  });
}

/** A terminal 80 columns wide with the keys given on its keyboard. */
function keyboard(keys: readonly string[]) {
  return { columns: 80, keys, rows: 24 };
}

/** A mock whose terminal has a keyboard only when keys are given. */
function withKeys(argv: string[], keys?: string[]) {
  return mockProcess({ argv, terminal: { columns: 80, keys, rows: 24 } });
}

/** The sentence a raw-mode switch with no entry left fails the keyboard with. */
const noKeysLeft = 'mockProcess has no keys left for this read. Add an entry to terminal.keys.';

describe('the keyboard', () => {
  it('answers two questions from two entries', async () => {
    const mock = mockProcess({ terminal: keyboard(['8080\r', 'ann\r']) });
    const code = await setup().run({ process: mock });
    expect([code, mock.stdout.text]).toEqual([0, 'Saved 8080 for ann.\n']);
  });

  it('holds a rejected answer and its retry in one entry', async () => {
    const mock = mockProcess({ terminal: keyboard(['bad\r\u007f\u007f\u007f8080\r', 'ann\r']) });
    const code = await setup().run({ process: mock });
    expect([code, mock.stdout.text]).toEqual([0, 'Saved 8080 for ann.\n']);
    expect(mock.stderr.text).toContain('Supply a number.');
  });

  it('one entry answers two questions an action opens at once', async () => {
    const mock = mockProcess({ terminal: keyboard(['8080\r9090\r']) });
    const app = new Application('app').action(async (context) => {
      const [first, second] = await Promise.all([
        ask(context, { message: 'First' }),
        ask(context, { message: 'Second' }),
      ]);
      await context.out.print(`${first} ${second}`);
    });
    const code = await app.run({ process: mock });
    expect([code, mock.stdout.text]).toEqual([0, '8080 9090\n']);
  });

  it('Ctrl-C at the second question ends the run with 130, and the re-raise ends the mock', async () => {
    const mock = mockProcess({ terminal: keyboard(['8080\r', '\u0003']) });
    const code = await setup().run({ process: mock });
    expect([code, mock.exitCode, mock.stdout.text]).toEqual([130, 130, '']);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(mock.endedBy).toBe('SIGINT');
  });

  it('Ctrl-Z suspends and resumes the question, and the resume takes the next entry', async () => {
    const mock = mockProcess({ terminal: keyboard(['\u001a', '8080\r', 'ann\r']) });
    const code = await setup().run({ process: mock });
    expect([code, mock.stdout.text, mock.endedBy]).toEqual([0, 'Saved 8080 for ann.\n', undefined]);
  });

  it('keys: [] is a terminal stdin and the signal source terminal, so the run is interactive', async () => {
    const mock = mockProcess({ terminal: keyboard([]) });
    const app = new Application('app').action(({ interactive, out }) =>
      out.print(String(interactive)),
    );
    const code = await app.run({ process: mock });
    expect([mock.stdin.isTTY, mock.terminal.stdin.isTTY, mock.signals.terminal]).toEqual([
      true,
      true,
      mock.stdin,
    ]);
    expect([code, mock.stdout.text]).toEqual([0, 'true\n']);
  });

  it('isRaw reads whether a reader holds the keyboard in raw mode', async () => {
    const mock = mockProcess({ terminal: keyboard(['8080\r']) });
    const seen: boolean[] = [mock.stdin.isRaw];
    // The question's validator runs while the question holds the keyboard.
    const holding: StandardSchemaV1<string, string> = {
      '~standard': {
        validate: (value: unknown) => {
          seen.push(mock.stdin.isRaw);
          return { value: String(value) };
        },
        vendor: 'test',
        version: 1,
      },
    };
    const app = new Application('app').action(async (context) => {
      await ask(context, { message: 'Port', validate: holding });
      seen.push(mock.stdin.isRaw);
    });
    await app.run({ process: mock });
    expect(seen).toEqual([false, true, false]);
  });

  it('answers the background query at once with no answer, and uses no entry', async () => {
    const mock = mockProcess({
      env: { TERM: 'xterm-256color' },
      terminal: keyboard(['8080\r', 'ann\r']),
    });
    const started = performance.now();
    const code = await setup([background()]).run({ process: mock });
    const elapsed = performance.now() - started;
    expect(mock.stderr.text).toContain('\u001b]11;?');
    expect([code, mock.stdout.text]).toEqual([0, 'Saved 8080 for ann.\n']);
    // The query's deadline is one second, which the run would reach had the mock not answered.
    expect(elapsed).toBeLessThan(1000);
  });

  it('a switch to raw mode with no entry left fails an opening question with exit 1', async () => {
    const mock = mockProcess({ terminal: keyboard(['8080\r']) });
    const code = await setup().run({ process: mock });
    expect([code, mock.exitCode, mock.stdout.text]).toEqual([1, 1, '']);
    expect(mock.stderr.text).toContain(noKeysLeft);
  });

  it('a resume with no entry left fails the run the same way and does not hang', async () => {
    const mock = mockProcess({ terminal: keyboard(['\u001a']) });
    const code = await setup().run({ process: mock });
    expect([code, mock.exitCode, mock.stdout.text]).toEqual([1, 1, '']);
    expect(mock.stderr.text).toContain(noKeysLeft);
  });

  it('the types make keys and piped stdin exclusive, and a MockTerminal still passes', () => {
    const terminal: MockTerminal = { columns: 80, rows: 24 };
    expect(mockProcess({ stdin: 'x', terminal }).stdin.isTTY).toBe(false);
    // @ts-expect-error A keyboard is the run's stdin, so piped text cannot stand beside it.
    mockProcess({ stdin: 'x', terminal: keyboard([]) });
  });

  it('the types accept a terminal whose keys may be absent', () => {
    expect(withKeys(['a']).stdin.isTTY).toBe(false);
    const keys: string[] | undefined = undefined as string[] | undefined;
    const conditional = mockProcess({
      terminal: keys ? { columns: 80, keys, rows: 24 } : { columns: 80, rows: 24 },
    });
    expect(conditional.stdin.isTTY).toBe(false);
    expect(mockProcess({ terminal: { columns: 80, keys: [], rows: 24 } }).stdin.isTTY).toBe(true);
  });
});
