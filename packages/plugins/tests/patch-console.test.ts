/*
 * Acceptance plan for the patch-console plugin (docs/plugins/patch-console.md).
 *
 * Each test runs an Application in the test's own process on a mock process whose stderr is on its
 * terminal, and puts back the console members it found whether the test passes or fails.
 *
 * - Streams. While a region is drawn, `console.log`, `info`, and `debug` write to the mock's stdout,
 *   which is not a terminal, and `warn` and `error` to its stderr above the frame. With stdout on the
 *   terminal too, a `console.log` reaches the mock's stdout and the frame is drawn again after it.
 * - The text. Arguments format as `util.format` formats them, with one line break added, and a
 *   dependency's color is removed under `NO_COLOR`.
 * - When it patches. Nothing is patched before the first frame, after the last frame, or in a run
 *   whose stderr is not a terminal. Several regions make one span.
 * - When it restores. The console comes back at the last region's close, at the run's end when a
 *   region was left open, and when the action fails.
 * - At the process's end. A `console.error` followed by the process's exit event while a frame is
 *   drawn prints the message above the frame in that step, and the console is back after it. With
 *   stdout on the terminal too, `console.log` and `console.error` calls and a second region's first
 *   frame queued before the exit event reach the screen in the order they were made, each stdout
 *   text between the stack's erase and its redraw. A mock never calls its `exit` listeners, so the
 *   test calls the one core adds to the mock's signal source.
 * - What it puts back. A member another library replaced meanwhile keeps that library's function,
 *   and a replacement still held after the restore calls the member it replaced.
 * - One holder. A second run whose span opens while the first holds the console patches nothing,
 *   and its writes go to the first run's streams until the first span closes.
 */
import { Application } from '@loomcli/core';
import type { Region } from '@loomcli/core';
import { patchConsole } from '@loomcli/plugins/patch-console';
import { mockProcess } from '@loomcli/testing';
import type { MockProcess, Write } from '@loomcli/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';

const literal = { render: (value: string) => value };

const members = ['log', 'info', 'debug', 'warn', 'error'] as const;

/** The members the test runner's console held before the test. */
type Saved = Record<(typeof members)[number], (...data: unknown[]) => void>;

let saved: Saved | undefined = undefined;

beforeEach(() => {
  saved = {
    debug: console.debug,
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn,
  };
});

afterEach(() => {
  if (saved !== undefined) {
    for (const member of members) {
      console[member] = saved[member];
    }
  }
});

/** Whether every member still holds what it held before the test. */
function untouched(): boolean {
  return members.every((member) => console[member] === saved?.[member]);
}

/** A mock process whose stderr alone is on its terminal, unless `streams` names both. */
function onTerminal(
  options: { env?: Record<string, string>; streams?: readonly ('stdout' | 'stderr')[] } = {},
): MockProcess {
  return mockProcess({
    env: options.env ?? {},
    terminal: { columns: 80, rows: 24, streams: options.streams ?? ['stderr'] },
  });
}

/** An Application with the plugin whose action draws one frame, runs `work`, and ends the region. */
function drawing(work: (region: Region) => unknown): Application {
  return new Application('ship', { plugins: [patchConsole()] }).action(async ({ out }) => {
    const region = out.region();
    await region.draw('frame', literal);
    await work(region);
    await region.end();
  });
}

/** Lets core write what the console members queued. */
async function written(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test('log, info, and debug write to the run stdout, and warn and error to its stderr above the frame', async () => {
  const mock = onTerminal();
  const app = drawing(async () => {
    console.log('logged');
    console.info('informed');
    console.debug('debugged');
    console.warn('warned');
    console.error('errored');
    await written();
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toBe('logged\ninformed\ndebugged\n');
  expect(mock.stderr.text).toContain('warned\n');
  expect(mock.stderr.text).toContain('errored\nframe');
  expect(untouched()).toBe(true);
});

/**
 * The process's `exit` event on a mock: calls every `exit` listener core added to the mock's signal
 * source and has not removed, with `code`.
 */
function exitEvent(mock: MockProcess): (code: number) => void {
  const on = vi.spyOn(mock.signals, 'on');
  const off = vi.spyOn(mock.signals, 'off');
  return (code) => {
    const removed = new Set(off.mock.calls.map(([, listener]) => listener));
    for (const [event, listener] of on.mock.calls) {
      if (event === 'exit' && !removed.has(listener)) {
        listener(code);
      }
    }
  };
}

test('a console.error followed by the exit event while a frame is drawn prints above the frame, and the console is back', async () => {
  const mock = onTerminal();
  const exit = exitEvent(mock);
  const atExit: [boolean, boolean, boolean][] = [];
  const app = drawing(() => {
    console.error('The migration lock is held.');
    exit(1);
    const { text } = mock.stderr;
    const message = text.indexOf('The migration lock is held.\n');
    // The message lands above the frame, which is drawn again below it before the cursor shows.
    atExit.push([message !== -1, text.slice(message).endsWith('frame\u001B[?25h'), untouched()]);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(atExit).toEqual([[true, true, true]]);
});

/** The bytes that erase a stack of `rows` rows, from the cursor at the end of its last row. */
function erase(rows: number): string {
  return rows === 1 ? '\r\u001B[J' : `\r\u001B[${String(rows - 1)}A\u001B[J`;
}

test('with stdout on the terminal too, console writes before the exit event reach the screen in the order they were made', async () => {
  const mock = onTerminal({ streams: ['stdout', 'stderr'] });
  const exit = exitEvent(mock);
  let atExit: readonly Write[] = [];
  const app = new Application('ship', { plugins: [patchConsole()] }).action(async ({ out }) => {
    await out.region().draw('FIRST', literal);
    const before = mock.transcript.length;
    console.log('OUT-1');
    console.error('ERR-1');
    console.log('OUT-2');
    void out.region().draw('SECOND', literal);
    console.error('ERR-2');
    exit(1);
    atExit = mock.transcript.slice(before);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  // Each stdout text is written between the erase of the stack and its redraw on stderr.
  expect(atExit).toEqual([
    { stream: 'stderr', text: erase(1) },
    { stream: 'stdout', text: 'OUT-1\n' },
    { stream: 'stderr', text: `FIRST${erase(1)}ERR-1\nFIRST${erase(1)}` },
    { stream: 'stdout', text: 'OUT-2\n' },
    {
      stream: 'stderr',
      text: `FIRST${erase(1)}FIRST\nSECOND${erase(2)}ERR-2\nFIRST\nSECOND\u001B[?25h`,
    },
  ]);
});

test('with stdout on the terminal too, a console.log lands on stdout and the frame is drawn again', async () => {
  const mock = onTerminal({ streams: ['stdout', 'stderr'] });
  const app = drawing(async () => {
    const before = mock.stderr.text;
    console.log('applied 0042_users');
    await written();
    expect(mock.stderr.text.slice(before.length)).toMatch(/frame$/u);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toBe('applied 0042_users\n');
});

test('the arguments format as util.format formats them, with one line break added', async () => {
  const mock = onTerminal();
  const app = drawing(async () => {
    console.log('%d migrations', 3, { table: 'users' });
    console.log('ends its own line\n');
    await written();
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toBe("3 migrations { table: 'users' }\nends its own line\n\n");
});

test("NO_COLOR removes a dependency's color from a routed write", async () => {
  const mock = onTerminal({ env: { NO_COLOR: '1' }, streams: ['stdout', 'stderr'] });
  const app = drawing(async () => {
    console.log('\u001B[31mred\u001B[39m');
    await written();
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toBe('red\n');
});

test('nothing is patched before the first frame or after the last one', async () => {
  const mock = onTerminal();
  const seen: boolean[] = [];
  const app = new Application('ship', { plugins: [patchConsole()] }).action(async ({ out }) => {
    const region = out.region();
    seen.push(untouched());
    await region.draw('frame', literal);
    seen.push(untouched());
    await region.end();
    seen.push(untouched());
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(seen).toEqual([true, false, true]);
});

test('a run whose stderr is not a terminal patches nothing', async () => {
  const mock = mockProcess();
  const app = drawing(() => {
    expect(untouched()).toBe(true);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
});

test('several regions make one span, and the console comes back at the last close', async () => {
  const mock = onTerminal();
  const seen: boolean[] = [];
  const app = new Application('ship', { plugins: [patchConsole()] }).action(async ({ out }) => {
    const first = out.region();
    const second = out.region();
    await first.draw('first', literal);
    await second.draw('second', literal);
    await first.end();
    console.log('between');
    seen.push(untouched());
    await second.end();
    seen.push(untouched());
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect([seen, mock.stdout.text]).toEqual([[false, true], 'between\n']);
});

test('the console comes back at the run end when the action leaves a region open', async () => {
  const mock = onTerminal();
  const app = new Application('ship', { plugins: [patchConsole()] }).action(async ({ out }) => {
    await out.region().draw('frame', literal);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(untouched()).toBe(true);
});

test('the console comes back when the action fails', async () => {
  const mock = onTerminal();
  const app = new Application('ship', { plugins: [patchConsole()] }).action(async ({ out }) => {
    await out.region().draw('frame', literal);
    throw new Error('The migration broke.');
  });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(untouched()).toBe(true);
});

/** A console member another library installs. */
const library = (): void => undefined;

test("a member another library replaced meanwhile keeps that library's function", async () => {
  const mock = onTerminal();
  const app = drawing(() => {
    console.warn = library;
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect([console.warn === library, console.log === saved?.log]).toEqual([true, true]);
});

test('a replacement still held after the restore calls the member it replaced', async () => {
  const mock = onTerminal();
  const calls: unknown[][] = [];
  console.log = (...data: unknown[]) => {
    calls.push(data);
  };
  const spy = console.log;
  const held: ((...data: unknown[]) => void)[] = [];
  const app = drawing(() => {
    held.push(console.log);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  for (const replacement of held) {
    replacement('late', 1);
  }
  expect([console.log === spy, calls, mock.stdout.text]).toEqual([true, [['late', 1]], '']);
});

test("a second run's span patches nothing while the first run holds the console", async () => {
  const first = onTerminal();
  const second = onTerminal();
  const release = Promise.withResolvers<void>();
  const drawn = Promise.withResolvers<void>();
  const holder = drawing(async () => {
    drawn.resolve();
    await release.promise;
  });
  const holding = holder.run({ process: first });
  await drawn.promise;
  const other = drawing(async () => {
    console.log('from the second run');
    await written();
  });
  await expect(other.run({ process: second })).resolves.toBe(0);
  release.resolve();
  await expect(holding).resolves.toBe(0);
  expect([first.stdout.text, second.stdout.text, untouched()]).toEqual([
    'from the second run\n',
    '',
    true,
  ]);
});
