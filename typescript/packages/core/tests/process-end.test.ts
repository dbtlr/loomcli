/*
 * Acceptance plan for what core writes when the process ends (docs/core/output.md#at-the-processs-end,
 * ADR-0157), proven in the test's own process on a mock process. A mock never calls its `exit`
 * listeners, so a test of the exit event calls the listener core adds to the mock's signal source,
 * which stands in for the process's own `exit` event.
 *
 * - The exit event. A message queued through `out` just before the exit event is written in that
 *   step, with a frame drawn or without one, on a terminal stderr and on a pipe.
 * - The order. Queued messages and frames are written in the order they were queued, byte for byte
 *   as their turns would have written them, and the cursor shows after them. With stdout on the
 *   terminal too, a `print` queued while a frame is drawn is written in the order both streams share,
 *   and a `print` whose turn has begun writes the parts it has not yet sent, once, before the frame
 *   is drawn again and the cursor shows.
 * - Once. A write the end wrote sends nothing when its turn comes, and with stdout on the terminal
 *   too, neither does a write whose turn was still waiting on the terminal's when the end came.
 * - A shutdown's end. A message queued just before `SIGQUIT`, or before a budget of 0 runs out, is
 *   written in that step.
 * - Nothing queued. A run with nothing queued writes the show-cursor sequence on a terminal stderr
 *   that holds a frame, and nothing on a pipe.
 * - The hooks. `'closed'` comes at the exit event after the queued bytes and before the
 *   `onShutdown` handlers, and a first frame the end writes calls no `'drawn'`.
 */
import { Application, plugin } from '@loomcli/core';
import type { LiveRegionsHook, Out } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import type { MockProcess } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

const literal = { render: (value: string) => value };

/** The control sequence that shows the cursor, which every end writes on a terminal that redraws. */
const showCursor = '\u001B[?25h';

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

/** A mock process whose stderr alone is on its terminal, unless `streams` names both. */
function onTerminal(streams: readonly ('stdout' | 'stderr')[] = ['stderr']): MockProcess {
  return mockProcess({ terminal: { columns: 80, rows: 24, streams } });
}

/** How many times `text` occurs in `within`. */
function occurrences(within: string, text: string): number {
  return within.split(text).length - 1;
}

test('a message queued just before the exit event is written in that step, and once', async () => {
  const mock = mockProcess();
  const exit = exitEvent(mock);
  let atExit = '';
  const app = new Application('ship').action(({ out }) => {
    void out.error('The schema file is missing.');
    exit(1);
    atExit = mock.stderr.text;
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(atExit).toBe('✘ The schema file is missing.\n');
  expect(occurrences(mock.stderr.text, 'The schema file is missing.')).toBe(1);
});

/**
 * Draws a frame, then queues a message, a second frame, and another message, and answers how much
 * of the mock's stderr was written before the queued writes.
 */
async function queue(out: Out, on: MockProcess): Promise<number> {
  const region = out.region();
  await region.draw('working 1/2', literal);
  const before = on.stderr.text.length;
  void out.error('first');
  void region.draw('working 2/2', literal);
  void out.warn('second');
  return before;
}

test('a message queued while a frame is drawn is written above it at the exit event', async () => {
  const mock = onTerminal();
  const exit = exitEvent(mock);
  const reference = onTerminal();
  let written = '';
  const app = new Application('ship').action(async ({ out }) => {
    const before = await queue(out, mock);
    exit(1);
    written = mock.stderr.text.slice(before);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  // The same writes, each written at its own turn, give the bytes the exit event must write.
  let expected = '';
  const turns = new Application('ship').action(async ({ out }) => {
    const before = await queue(out, reference);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expected = reference.stderr.text.slice(before);
  });
  await expect(turns.run({ process: reference })).resolves.toBe(0);
  expect(expected).toContain('second');
  expect(written).toBe(`${expected}${showCursor}`);
});

test('with stdout on the terminal too, a print queued while a frame is drawn is written to stdout at the exit event', async () => {
  const mock = onTerminal(['stdout', 'stderr']);
  const exit = exitEvent(mock);
  const seen: string[] = [];
  const app = new Application('ship').action(async ({ out }) => {
    await out.region().draw('working', literal);
    void out.print('applied 0042_users');
    void out.error('failed 0043_orders');
    exit(1);
    seen.push(mock.stdout.text, mock.stderr.text);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  const [stdout = '', stderr = ''] = seen;
  const message = stderr.indexOf('failed 0043_orders\n');
  // The message lands above the frame, which is drawn again below it before the cursor shows.
  expect([stdout, message !== -1, stderr.slice(message).endsWith(`working${showCursor}`)]).toEqual([
    'applied 0042_users\n',
    true,
    true,
  ]);
});

test('a write the exit event wrote sends nothing when its turn comes', async () => {
  const mock = onTerminal();
  const exit = exitEvent(mock);
  const app = new Application('ship').action(async ({ out }) => {
    await out.region().draw('working', literal);
    const pending = out.error('written once');
    exit(1);
    await pending;
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(occurrences(mock.stderr.text, 'written once')).toBe(1);
});

test('with stdout on the terminal too, a write the exit event wrote while its turn waited sends nothing when the turn comes', async () => {
  const mock = onTerminal(['stdout', 'stderr']);
  const exit = exitEvent(mock);
  const texts = ['burst one', 'burst two', 'burst three', 'burst four'];
  const app = new Application('ship').action(async ({ out }) => {
    await out.region().draw('working', literal);
    // The burst alternates stderr and stdout, starting with stderr.
    const pending = texts.map((text, index) =>
      index % 2 === 0 ? out.error(text) : out.print(text),
    );
    // The first write has reached its place in the order, and its turn waits on the terminal's.
    await Promise.resolve();
    exit(1);
    await Promise.all(pending);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  const screen = mock.transcript.map(({ text }) => text).join('');
  expect(texts.map((text) => occurrences(screen, text))).toEqual([1, 1, 1, 1]);
});

/**
 * Waits, a microtask at a time and never a macrotask, until `begun` reads true, so a stream's write
 * callback, which Node defers to a later tick, has not yet run.
 */
async function microtasksUntil(begun: () => boolean): Promise<boolean> {
  for (let step = 0; step < 100 && !begun(); step += 1) {
    await Promise.resolve();
  }
  return begun();
}

test('with stdout on the terminal too, a print whose turn has begun writes its unsent parts at the exit event, once', async () => {
  const mock = onTerminal(['stdout', 'stderr']);
  const exit = exitEvent(mock);
  const seen: [boolean, string, string] = [false, '', ''];
  const app = new Application('ship').action(async ({ out }) => {
    await out.region().draw('working', literal);
    const erased = mock.stderr.text.length;
    void out.print('applied');
    // The print's turn has begun once the erase before it reaches stderr.
    seen[0] = await microtasksUntil(() => mock.stderr.text.length > erased);
    exit(1);
    seen[1] = mock.stdout.text;
    seen[2] = mock.stderr.text;
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  const [begun, stdout, stderr] = seen;
  expect([begun, stdout, stderr.endsWith(`working${showCursor}`)]).toEqual([
    true,
    'applied\n',
    true,
  ]);
  expect(occurrences(mock.stdout.text, 'applied')).toBe(1);
});

test('a message queued just before SIGQUIT is written at the shutdown end', async () => {
  const mock = onTerminal();
  let atEnd = '';
  const app = new Application('ship').action(async ({ out }) => {
    await out.region().draw('working', literal);
    void out.error('The deploy was interrupted.');
    mock.signals.raise('SIGQUIT');
    atEnd = mock.stderr.text;
  });
  await app.run({ process: mock });
  expect(mock.endedBy).toBe('SIGQUIT');
  expect(atEnd).toContain('The deploy was interrupted.\n');
  expect(atEnd.endsWith(showCursor)).toBe(true);
});

test('a message the unwind queues before a budget of 0 runs out is written at the shutdown end', async () => {
  const mock = mockProcess();
  const ready = Promise.withResolvers<void>();
  let atEnd = '';
  const app = new Application('ship', { shutdown: { timeout: 0 } }).action(
    async ({ out, signal }) => {
      signal.addEventListener('abort', () => {
        void out.error('Stopped before the upload.');
      });
      ready.resolve();
      await new Promise(() => undefined);
    },
  );
  void app.run({ process: mock });
  await ready.promise;
  mock.signals.raise('SIGTERM');
  atEnd = mock.stderr.text;
  expect([mock.endedBy, atEnd]).toEqual(['SIGTERM', '✘ Stopped before the upload.\n']);
});

test('with nothing queued, the exit event writes the show-cursor sequence on a terminal and nothing on a pipe', async () => {
  const terminal = onTerminal();
  const pipe = mockProcess();
  const seen: string[] = [];
  for (const mock of [terminal, pipe]) {
    const exit = exitEvent(mock);
    const app = new Application('ship').action(async ({ out }) => {
      await out.region().draw('working', literal);
      const before = mock.stderr.text.length;
      exit(1);
      seen.push(mock.stderr.text.slice(before));
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
  }
  expect(seen).toEqual([showCursor, '']);
});

test("the exit event calls 'closed' after the queued bytes and before the onShutdown handlers", async () => {
  const mock = onTerminal();
  const exit = exitEvent(mock);
  const order: string[] = [];
  const hook: LiveRegionsHook = (state) => {
    order.push(`${state}:${String(mock.stderr.text.includes('queued last'))}`);
  };
  const app = new Application('ship', {
    plugins: [plugin('fixture/regions', { onLiveRegions: hook })],
  }).action(async ({ onShutdown, out }) => {
    onShutdown((event) => {
      order.push(`handler:${event.cause}:${String(event.code)}`);
    });
    await out.region().draw('working', literal);
    void out.error('queued last');
    exit(1);
    atExit = [...order];
  });
  let atExit: string[] = [];
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(atExit).toEqual(['drawn:false', 'closed:true', 'handler:exit:1']);
});

test("a first frame the exit event writes calls no 'drawn' and opens no span", async () => {
  const mock = onTerminal();
  const exit = exitEvent(mock);
  const states: string[] = [];
  const hook: LiveRegionsHook = (state) => {
    states.push(state);
  };
  let atExit: [string, string[]] = ['', []];
  const app = new Application('ship', {
    plugins: [plugin('fixture/regions', { onLiveRegions: hook })],
  }).action(({ out }) => {
    void out.region().draw('first frame', literal);
    exit(1);
    atExit = [mock.stderr.text, [...states]];
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect([atExit[0].includes('first frame'), atExit[1]]).toEqual([true, []]);
});
