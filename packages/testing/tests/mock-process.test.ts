import { Application, Command } from '@loomcli/core';
import type { ProcessSignal } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { describe, expect, it } from 'vite-plus/test';

import { mockProcess } from '../src/index.js';
import type { MockProcess } from '../src/index.js';

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

describe('piped stdin', () => {
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
    expect(mock.terminal.background).toBeDefined();
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

  it('a signal raised on the mock reaches a listener the code installed', async () => {
    const mock = mockProcess();
    const heard: string[] = [];
    mock.signals.on('SIGINT', () => heard.push('SIGINT'));
    mock.signals.raise('SIGINT');
    expect(heard).toEqual(['SIGINT']);
    expect(mock.endedBy).toBeUndefined();
  });
});
