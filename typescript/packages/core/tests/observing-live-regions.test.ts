/*
 * Acceptance plan for observing live regions (docs/core/lifecycle-hooks.md#observing-live-regions).
 *
 * The hook is proven when public APIs alone produce these results, on a mock process whose stderr
 * is on its terminal unless a test says otherwise:
 *
 * - The two points. `'drawn'` comes before the first frame's bytes and `'closed'` after the bytes
 *   that move the last frame into scrollback, and the promises `draw` and `end` return resolve after
 *   the hook ran.
 * - One span. Regions open at once make one span, and a run that closes its last region and later
 *   draws another calls `'drawn'`, `'closed'`, `'drawn'`, `'closed'`.
 * - Every region of the run. A middleware's region opens a span. A Command an action reaches
 *   through `invoke` calls no hook, and the parent's span stays open across the call.
 * - Held frames. A region that closes while an input region holds it, or during a lend, closes the
 *   span only when the input region closes or the lend ends.
 * - No span. A region that never draws, `out.draw`, a stderr that is not a terminal, and a region
 *   without `input: true` under `CI` call no hook; an input region under `CI` opens a span.
 * - Failure and cancellation. A failing run calls `'closed'` before its report's bytes. A cancelled
 *   run calls `'closed'`. `SIGQUIT` calls `'closed'` before the `onShutdown` handlers.
 * - The run's end. A run whose stderr failed while a frame was held calls `'closed'` before `run()`
 *   resolves.
 * - The context. It is one frozen object per run, two runs at once get two, and a write through its
 *   `out` lands above the regions.
 * - Broken hooks. A hook that throws stays installed and leaves a later plugin's hook called, and
 *   its first throw is reported once with exit 1; a cancelled run keeps its signal's code.
 */
import { Application, Command, FatalError, plugin } from '@loomcli/core';
import type { LiveRegionsHook, LiveRegionsHookContext, Plugin } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import type { MockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

const literal = { render: (value: string) => value };

/** One call a recording hook saw: the state, what stderr held then, and the context. */
interface Seen {
  readonly state: 'drawn' | 'closed';
  readonly stderr: string;
  readonly context: LiveRegionsHookContext;
}

/** A plugin whose hook records each call it receives, with the mock's stderr at that moment. */
function recording(
  mock: MockProcess,
  identity = 'fixture/regions',
): { installed: Plugin; seen: Seen[] } {
  const seen: Seen[] = [];
  const hook: LiveRegionsHook = (state, context) => {
    seen.push({ context, state, stderr: mock.stderr.text });
  };
  return { installed: plugin(identity, { onLiveRegions: hook }), seen };
}

/** The states a recording hook saw, in order. */
function states(seen: readonly Seen[]): string[] {
  return seen.map(({ state }) => state);
}

/** A mock process whose stderr alone is on its terminal. */
function onTerminal(env: Record<string, string> = {}): MockProcess {
  return mockProcess({ env, terminal: { columns: 80, rows: 24, streams: ['stderr'] } });
}

test("'drawn' comes before the first frame's bytes and 'closed' after the closing bytes", async () => {
  const mock = onTerminal();
  const { installed, seen } = recording(mock);
  const app = new Application('regions', { plugins: [installed] }).action(async ({ out }) => {
    const region = out.region();
    await region.draw('frame', literal);
    expect(states(seen)).toEqual(['drawn']);
    await region.end();
    expect(states(seen)).toEqual(['drawn', 'closed']);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(seen.map(({ stderr }) => stderr)).toEqual(['', 'frame\n']);
});

test('regions open at once make one span, and a later region opens another', async () => {
  const mock = onTerminal();
  const { installed, seen } = recording(mock);
  const app = new Application('regions', { plugins: [installed] }).action(async ({ out }) => {
    const first = out.region();
    const second = out.region();
    await first.draw('first', literal);
    await second.draw('second', literal);
    await first.end();
    expect(states(seen)).toEqual(['drawn']);
    await second.end();
    expect(states(seen)).toEqual(['drawn', 'closed']);
    const later = out.region();
    await later.draw('later', literal);
    await later.end();
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(states(seen)).toEqual(['drawn', 'closed', 'drawn', 'closed']);
});

test("a middleware's region opens a span, which closes once the chain has unwound", async () => {
  const mock = onTerminal();
  const { installed, seen } = recording(mock);
  const around = plugin('fixture/around', {
    middleware: {
      activate: 'always',
      load: async () => ({
        default: async ({ next, out }) => {
          await out.region().draw('middleware frame', literal);
          await next();
        },
      }),
    },
  });
  let during: string[] = [];
  const app = new Application('regions', { plugins: [installed, around] }).action(() => {
    during = states(seen);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect([during, states(seen)]).toEqual([['drawn'], ['drawn', 'closed']]);
});

test('a Command reached through invoke calls no hook, and the parent span stays open across it', async () => {
  const mock = onTerminal();
  const { installed, seen } = recording(mock);
  let live: boolean | undefined = undefined;
  const app = new Application('regions', { plugins: [installed] })
    .command(
      new Command('inner').action(async ({ out }) => {
        const region = out.region();
        live = region.live;
        await region.draw('inner frame', literal);
        await region.end();
      }),
    )
    .action(async ({ invoke, out }) => {
      const region = out.region();
      await region.draw('outer frame', literal);
      await invoke(['inner'], {});
      expect(states(seen)).toEqual(['drawn']);
      await region.end();
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect([live, states(seen)]).toEqual([false, ['drawn', 'closed']]);
});

test('a region that closes while an input region holds it closes the span with the input region', async () => {
  const mock = onTerminal();
  const { installed, seen } = recording(mock);
  const app = new Application('regions', { plugins: [installed] }).action(async ({ out }) => {
    const region = out.region();
    await region.draw('frame', literal);
    const question = out.region({ input: true });
    await question.draw('question', literal);
    await region.end();
    expect(states(seen)).toEqual(['drawn']);
    await question.end();
    expect(states(seen)).toEqual(['drawn', 'closed']);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
});

test('a region that closes during a lend closes the span when the lend ends', async () => {
  const mock = onTerminal();
  const { installed, seen } = recording(mock);
  const app = new Application('regions', { plugins: [installed] }).action(async ({ out }) => {
    const region = out.region();
    await region.draw('frame', literal);
    await out.lendTerminal(async () => {
      await region.end();
      expect(states(seen)).toEqual(['drawn']);
    });
    expect(states(seen)).toEqual(['drawn', 'closed']);
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
});

test('a region that never draws and a frame out.draw writes open no span', async () => {
  const mock = onTerminal();
  const { installed, seen } = recording(mock);
  const app = new Application('regions', { plugins: [installed] }).action(async ({ out }) => {
    const region = out.region();
    await out.draw('drawn by hand', literal);
    await region.end();
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(seen).toEqual([]);
});

test('a stderr that is not a terminal calls no hook', async () => {
  const mock = mockProcess();
  const { installed, seen } = recording(mock);
  const app = new Application('regions', { plugins: [installed] }).action(async ({ out }) => {
    const region = out.region({ input: true });
    await region.draw('frame', literal);
    await region.end();
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(seen).toEqual([]);
});

test('under CI only an input region opens a span', async () => {
  const mock = onTerminal({ CI: 'true' });
  const { installed, seen } = recording(mock);
  let between: string[] = [];
  const app = new Application('regions', { plugins: [installed] }).action(async ({ out }) => {
    const region = out.region();
    await region.draw('progress', literal);
    await region.end();
    between = states(seen);
    const question = out.region({ input: true });
    await question.draw('question', literal);
    await question.end();
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect([between, states(seen)]).toEqual([[], ['drawn', 'closed']]);
});

test("a failing run calls 'closed' before its report's bytes", async () => {
  const mock = onTerminal();
  const { installed, seen } = recording(mock);
  const app = new Application('regions', { plugins: [installed] }).action(async ({ out }) => {
    await out.region().draw('frame', literal);
    throw new FatalError('The work broke.');
  });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(states(seen)).toEqual(['drawn', 'closed']);
  expect(seen[1]?.stderr).not.toContain('The work broke.');
  expect(mock.stderr.text).toContain('The work broke.');
});

test("a cancelled run calls 'closed' and keeps its signal's code", async () => {
  const mock = onTerminal();
  const { installed, seen } = recording(mock);
  const caller = new AbortController();
  const app = new Application('regions', { plugins: [installed] }).action(
    async ({ out, signal }) => {
      await out.region().draw('frame', literal);
      caller.abort();
      expect(signal.aborted).toBe(true);
    },
  );
  await expect(app.run({ process: mock, signal: caller.signal })).resolves.toBe(130);
  expect(states(seen)).toEqual(['drawn', 'closed']);
});

test("SIGQUIT calls 'closed' before the onShutdown handlers", async () => {
  const mock = onTerminal();
  const order: string[] = [];
  const hook: LiveRegionsHook = (state) => {
    order.push(state);
  };
  const ready = Promise.withResolvers<void>();
  const app = new Application('regions', {
    plugins: [plugin('fixture/regions', { onLiveRegions: hook })],
  }).action(async ({ onShutdown, out, signal }) => {
    onShutdown(() => {
      order.push('handler');
    });
    await out.region().draw('frame', literal);
    ready.resolve();
    await new Promise((resolve) => {
      signal.addEventListener('abort', resolve);
    });
  });
  const run = app.run({ process: mock });
  await ready.promise;
  mock.signals.raise('SIGQUIT');
  expect([mock.endedBy, order]).toEqual(['SIGQUIT', ['drawn', 'closed', 'handler']]);
  await run;
});

test("a run whose stderr failed while a frame was held calls 'closed' before run() resolves", async () => {
  const mock = onTerminal();
  const { installed, seen } = recording(mock);
  const app = new Application('regions', { plugins: [installed] }).action(async ({ out }) => {
    await out.region().draw('frame', literal);
    mock.stderr.destroy(new Error('The terminal hung up.'));
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(states(seen)).toEqual(['drawn', 'closed']);
});

test('the context is one frozen object per run, and two runs at once get one each', async () => {
  const first = onTerminal();
  const second = onTerminal();
  const seen: LiveRegionsHookContext[] = [];
  const hook: LiveRegionsHook = (_state, context) => {
    seen.push(context);
  };
  const app = new Application('regions', {
    plugins: [plugin('fixture/regions', { onLiveRegions: hook })],
  }).action(async ({ out }) => {
    const region = out.region();
    await region.draw('frame', literal);
    await region.end();
  });
  await expect(
    Promise.all([app.run({ process: first }), app.run({ process: second })]),
  ).resolves.toEqual([0, 0]);
  expect(seen).toHaveLength(4);
  expect(new Set(seen).size).toBe(2);
  expect(seen.every((context) => Object.isFrozen(context))).toBe(true);
});

/** A hook that writes a note through its context's `out` when the span opens. */
const noting: LiveRegionsHook = (state, { out }) => {
  if (state === 'drawn') {
    void out.warn('A note from the hook.', literal);
  }
};

/** A hook that throws at every call. */
const throwing: LiveRegionsHook = () => {
  throw new TypeError('The hook broke.');
};

test("a write through the context's out lands above the regions", async () => {
  const mock = onTerminal();
  const app = new Application('regions', {
    plugins: [plugin('fixture/regions', { onLiveRegions: noting })],
  }).action(async ({ out }) => {
    const region = out.region();
    await region.draw('frame', literal);
    await region.end();
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toContain('A note from the hook.\nframe');
});

test('a hook that throws stays installed, leaves a later hook called, and is reported once', async () => {
  const mock = onTerminal();
  let thrown = 0;
  const counted: LiveRegionsHook = (state, context) => {
    thrown += 1;
    return throwing(state, context);
  };
  const { installed, seen } = recording(mock, 'fixture/later');
  const app = new Application('regions', {
    plugins: [plugin('fixture/throwing', { onLiveRegions: counted }), installed],
  }).action(async ({ out }) => {
    const region = out.region();
    await region.draw('frame', literal);
    await region.end();
  });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect([thrown, states(seen)]).toEqual([2, ['drawn', 'closed']]);
  expect(mock.stderr.text.split('@loomcli/core/foreign-throw')).toHaveLength(2);
  expect(mock.stderr.text).toContain('The hook broke.');
});

test("a throwing hook in a cancelled run keeps the signal's code", async () => {
  const mock = onTerminal();
  const caller = new AbortController();
  const app = new Application('regions', {
    plugins: [plugin('fixture/throwing', { onLiveRegions: throwing })],
  }).action(async ({ out }) => {
    await out.region().draw('frame', literal);
    caller.abort();
  });
  await expect(app.run({ process: mock, signal: caller.signal })).resolves.toBe(130);
});
