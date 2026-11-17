/*
 * Acceptance plan for task groups (docs/libs/prompts.md#task-groups, ADR-0173). Each tree runs in
 * an application on a mock terminal 60 columns wide, its clock and its root's frame timer faked
 * inside the action, so a frame draws only when the test moves the clock, calls `update`, or ends a
 * line. An override of the progress view notes each frame's data and the default view's plain text
 * for it, and a headless terminal emulator replays stderr where the test reads the screen and its
 * scrollback.
 *
 * - The tree. A parent's tasks draw indented under it in the order they opened, a task opened after
 *   an unrelated line still draws directly under its parent, and nesting reaches any depth.
 * - A task's end while its parent runs. Each end draws its end line in its place, `clear()` removes
 *   it, and its end line keeps the elapsed time it ended with.
 * - A parent's end. A still-open task takes the parent's end; success and a skip collapse the
 *   tasks with no blank row, `keepTasks` keeps them, and a failure, a warning, a failing run, and
 *   a cancellation keep them in scrollback; a nested group that fails keeps its tasks in place.
 *   `clear()` on a parent removes the whole tree.
 * - A task's log. Its rows draw indented under it; on a failure its kept lines wait and are written
 *   directly above its end line with the tree, and a later collapse discards them.
 * - The terminal's height. A tree on a short terminal never draws a frame taller than the
 *   terminal, its oldest finished rows give way first, no row shows twice in scrollback, and a kept
 *   tree is written whole.
 * - Where the tree does not draw. Piped, under `TERM=dumb`, CI, `--plain`, `-q`, and an invocation
 *   by name, each line writes its plain lines when they happen, indented, in the order they happen.
 * - The rest. `track()` on a task, `task()` after an end, each task's progress events, and the
 *   view's data, drawn by an override and built by hand.
 *
 * `progress-tasks-pty.test.ts` proves a drawn tree, its collapse, and a kept tree on a real
 * terminal.
 */
import { Application, FatalError, override } from '@loomcli/core';
import type { ActionContext, ProgressEvent, ViewContext } from '@loomcli/core';
import { plain as plainPlugin } from '@loomcli/plugins/plain';
import { verbose } from '@loomcli/plugins/verbose';
import { mockProcess } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

import { replay, until } from '../../../scripts/test-screen.js';
import type { Recorded } from '../../../scripts/test-screen.js';
import { progress, progressStyle } from '../src/index.js';
import type { Progress } from '../src/index.js';
import { progressLine } from '../src/views.js';
import type { ProgressLine } from '../src/views.js';
import { recording } from './support.js';

/** One frame the root drew: the data its view received and the default view's plain text for it. */
interface Drawn {
  readonly data: ProgressLine;
  readonly text: string;
}

/** What a script reads beside the action's context. */
interface Scene {
  /** Fires the frame timers once, 100 ms on, which draws each tree's next frame. */
  readonly tick: () => void;
  /** Notes a named point in the order of stderr's writes, once the writes issued before it land. */
  readonly mark: (name: string) => Promise<void>;
  /** Cancels the run, as an operator's Ctrl-C does. */
  readonly cancel: () => void;
}

/** How a run is set up. */
interface Setup {
  readonly rows?: number;
  readonly terminal?: 'tty' | 'pipe' | 'invoke';
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly argv?: readonly string[];
  readonly render?: (data: ProgressLine, context: ViewContext) => string;
}

/** What a run left: its frames, its screen events, its stderr, its messages, and its events. */
interface Outcome {
  readonly code: number | string;
  readonly events: Recorded[];
  readonly frames: Drawn[];
  readonly messages: string | undefined;
  readonly progress: ProgressEvent[];
  readonly rows: number;
  readonly stderr: string;
}

/** A spinner of one frame, so a test reads a still line, whose timer fires each 100 ms. */
const spinner = { frames: ['◐'], interval: 100 };

/** The environment of a run with no color. */
const noColor = { COLORTERM: undefined, FORCE_COLOR: undefined, NO_COLOR: '1', TERM: 'xterm' };

/** Lets every pending promise settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Runs `script` as an action, the clock at 0 when it starts, and answers what the run left. */
async function grouped(
  script: (context: ActionContext<unknown>, scene: Scene) => Promise<void>,
  { argv = [], env = {}, render, rows = 24, terminal = 'tty' }: Setup = {},
): Promise<Outcome> {
  const frames: Drawn[] = [];
  const reported: ProgressEvent[] = [];
  const mock = mockProcess({
    argv: [...argv],
    env: { ...noColor, ...env },
    terminal: { columns: 60, rows, streams: terminal === 'tty' ? ['stderr'] : [] },
  });
  const screen = recording(mock);
  const caller = new AbortController();
  const app = new Application('deploy', {
    description: 'Show a task group.',
    plugins: [progressStyle({ spinner }), verbose(), plainPlugin()],
    views: [
      override(progressLine, {
        render: (data, context) => {
          const text = (render ?? progressLine.render)(data, context);
          frames.push({ data, text: context.plain(text) });
          return text;
        },
      }),
    ],
  }).action(async (context) => {
    // Scope the fake clock to the action so run setup and teardown keep real timers.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(0);
    try {
      await script(context, {
        cancel: () => {
          caller.abort();
        },
        mark: async (name) => {
          await flush();
          screen.mark(name);
        },
        tick: () => {
          vi.advanceTimersByTime(spinner.interval);
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });
  let code: number | string = 0;
  let messages: string | undefined = undefined;
  if (terminal === 'invoke') {
    const outcome = await app.invoke(
      [],
      {},
      {
        onProgress: (event) => {
          reported.push(event);
        },
        process: mockProcess({ env: noColor }),
      },
    );
    code = outcome.status;
    messages = outcome.status === 'cancelled' ? undefined : outcome.messages;
  } else {
    code = await app.run({ process: mock, signal: caller.signal });
  }
  return {
    code,
    events: screen.events(),
    frames,
    messages,
    progress: reported,
    rows,
    stderr: mock.stderr.text,
  };
}

/** Every row the emulator holds, scrollback first, once it has taken the events up to the mark. */
async function shown(outcome: Outcome, mark?: string): Promise<readonly string[]> {
  const screen = await replay(until(outcome.events, mark), { columns: 60, rows: outcome.rows });
  return screen.lines;
}

/** The rows that appear more than once among `rows`, blank rows aside. */
function repeated(rows: readonly string[]): string[] {
  const seen = new Map<string, number>();
  for (const line of rows.filter((row) => row !== '')) {
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([line]) => line);
}

/** Each event as `[id, state, label]`, which a test reads in order. */
function eventsOf(outcome: Outcome): (readonly [number, string, string])[] {
  return outcome.progress.map(({ id, label, state }) => [id, state, label] as const);
}

/** The labels of a frame's tasks, at every depth, each after two spaces for each level. */
function outline(data: ProgressLine): string[] {
  return [
    `${'  '.repeat(data.depth ?? 0)}${data.state} ${data.label}`,
    ...(data.tasks ?? []).flatMap((task) => outline(task)),
  ];
}

test('a parent draws its two tasks indented under it, in the order they opened', async () => {
  const outcome = await grouped(async (context, { mark, tick }) => {
    const deploying = progress(context, { label: 'Deploying' });
    deploying.task({ label: 'Building the image' });
    deploying.task({ label: 'Pushing the image', total: 3 }).update({ completed: 1 });
    tick();
    await mark('running');
  });
  await expect(shown(outcome, 'running')).resolves.toEqual([
    '◐ Deploying · 0.1s',
    '  ◐ Building the image · 0.1s',
    '  ◐ Pushing the image ▰▰▰▱▱▱▱▱▱▱ 1/3 · 0.1s',
  ]);
});

test('a task opened after an unrelated line still draws directly under its parent', async () => {
  const outcome = await grouped(async (context, { mark }) => {
    const deploying = progress(context, { label: 'Deploying' });
    progress(context, { label: 'Watching the logs' });
    deploying.task({ label: 'Building the image' });
    await mark('running');
  });
  await expect(shown(outcome, 'running')).resolves.toEqual([
    '◐ Deploying · 0.0s',
    '  ◐ Building the image · 0.0s',
    '◐ Watching the logs · 0.0s',
  ]);
});

test('tasks nest to any depth, each level two columns further in', async () => {
  const outcome = await grouped(async (context, { mark }) => {
    const deploying = progress(context, { label: 'Deploying' });
    const building = deploying.task({ label: 'Building' });
    const compiling = building.task({ label: 'Compiling' });
    compiling.task({ label: 'Parsing' });
    deploying.task({ label: 'Pushing' });
    await mark('running');
  });
  await expect(shown(outcome, 'running')).resolves.toEqual([
    '◐ Deploying · 0.0s',
    '  ◐ Building · 0.0s',
    '    ◐ Compiling · 0.0s',
    '      ◐ Parsing · 0.0s',
    '  ◐ Pushing · 0.0s',
  ]);
  expect(outline(lastRunning(outcome))).toEqual([
    'running Deploying',
    '  running Building',
    '    running Compiling',
    '      running Parsing',
    '  running Pushing',
  ]);
});

test.each<[string, (task: Progress) => Promise<unknown>, string | undefined, string]>([
  ['end', (task) => task.end('Built the image'), '  ✔ Built the image · 0.1s', 'ended'],
  ['skip', (task) => task.skip('Built nothing'), '  ℹ Built nothing · 0.1s', 'skipped'],
  ['fail', (task) => task.fail(), '  ✘ Building the image · 0.1s', 'failed'],
  [
    'warn',
    (task) => task.warn('Built with 2 warnings'),
    '  ⚠ Built with 2 warnings · 0.1s',
    'warned',
  ],
  [
    'a resolved track',
    (task) => task.track(Promise.resolve(3), { done: (count) => `Built ${String(count)} layers` }),
    '  ✔ Built 3 layers · 0.1s',
    'ended',
  ],
  [
    'a rejected track',
    (task) =>
      task
        .track(Promise.reject(new Error('no space')), { failed: 'Ran out of space' })
        .catch(() => undefined),
    '  ✘ Ran out of space · 0.1s',
    'failed',
  ],
  ['clear', (task) => task.clear(), undefined, 'ended'],
])(
  '%s on a task draws its end in its place while the parent runs',
  async (_name, end, row, state) => {
    const outcome = await grouped(async (context, { mark, tick }) => {
      const deploying = progress(context, { label: 'Deploying' });
      const building = deploying.task({ label: 'Building the image' });
      deploying.task({ label: 'Pushing the image' });
      tick();
      await end(building);
      await mark('ended');
    });
    await expect(shown(outcome, 'ended')).resolves.toEqual([
      '◐ Deploying · 0.1s',
      ...(row === undefined ? [] : [row]),
      '  ◐ Pushing the image · 0.1s',
    ]);
    const ending = await grouped(
      async (context) => {
        const deploying = progress(context, { label: 'Deploying' });
        const building = deploying.task({ label: 'Building the image' });
        await end(building);
        await deploying.end();
      },
      { terminal: 'invoke' },
    );
    expect(eventsOf(ending).map(([id, event]) => [id, event])).toEqual([
      [1, 'started'],
      [2, 'started'],
      [2, state],
      [1, 'ended'],
    ]);
  },
);

test("a finished task's end line keeps the elapsed time it ended with while its parent runs on", async () => {
  const outcome = await grouped(async (context, { mark, tick }) => {
    const deploying = progress(context, { label: 'Deploying' });
    const building = deploying.task({ label: 'Building the image' });
    tick();
    await building.end('Built the image');
    for (let count = 0; count < 4; count += 1) {
      tick();
    }
    await mark('later');
  });
  await expect(shown(outcome, 'later')).resolves.toEqual([
    '◐ Deploying · 0.5s',
    '  ✔ Built the image · 0.1s',
  ]);
});

test("a parent's success collapses its tasks, so only its end line stays, with no blank row", async () => {
  const outcome = await grouped(async (context, { mark, tick }) => {
    const deploying = progress(context, { label: 'Deploying' });
    const building = deploying.task({ label: 'Building the image' });
    building.task({ label: 'Compiling' });
    deploying.task({ label: 'Pushing the image' });
    await building.fail();
    tick();
    await mark('running');
    await deploying.end('Deployed');
    await mark('ended');
  });
  await expect(shown(outcome, 'running')).resolves.toEqual([
    '◐ Deploying · 0.1s',
    '  ✘ Building the image · 0.0s',
    '    ✘ Compiling · 0.0s',
    '  ◐ Pushing the image · 0.1s',
  ]);
  await expect(shown(outcome, 'ended')).resolves.toEqual(['✔ Deployed · 0.1s']);
  expect(outline(outcome.frames.at(-1)?.data ?? progressData())).toEqual(['ended Deployed']);
});

test('a skip on a parent collapses its tasks as a success does', async () => {
  const outcome = await grouped(async (context) => {
    const deploying = progress(context, { label: 'Deploying' });
    deploying.task({ label: 'Building the image' });
    await deploying.skip('Deployed nothing: the image is current');
  });
  await expect(shown(outcome)).resolves.toEqual([
    'ℹ Deployed nothing: the image is current · 0.0s',
  ]);
});

test('keepTasks keeps the tasks under a parent that succeeds, written into scrollback', async () => {
  const outcome = await grouped(async (context, { tick }) => {
    const deploying = progress(context, { keepTasks: true, label: 'Deploying' });
    const building = deploying.task({ label: 'Building the image' });
    building.task({ label: 'Compiling' });
    const pushing = deploying.task({ label: 'Pushing the image' });
    tick();
    await building.end('Built the image');
    tick();
    await pushing.end('Pushed the image');
    await deploying.end('Deployed');
  });
  const rows = await shown(outcome);
  expect(rows).toEqual([
    '✔ Deployed · 0.2s',
    '  ✔ Built the image · 0.1s',
    '  ✔ Pushed the image · 0.2s',
  ]);
  expect(repeated(rows)).toEqual([]);
});

test("keepTasks is the group's own: a task's own tasks collapse by the task's setting", async () => {
  const outcome = await grouped(async (context) => {
    const deploying = progress(context, { keepTasks: true, label: 'Deploying' });
    const building = deploying.task({ label: 'Building' });
    building.task({ label: 'Compiling' });
    const pushing = deploying.task({ keepTasks: true, label: 'Pushing' });
    pushing.task({ label: 'Uploading' });
    await deploying.end('Deployed');
  });
  await expect(shown(outcome)).resolves.toEqual([
    '✔ Deployed · 0.0s',
    '  ✔ Building · 0.0s',
    '  ✔ Pushing · 0.0s',
    '    ✔ Uploading · 0.0s',
  ]);
});

test.each<[string, (line: Progress) => Promise<void>, readonly string[]]>([
  [
    'fail',
    (line) => line.fail(),
    [
      '✘ Deploying · 0.1s',
      '  ✔ Built the image · 0.1s',
      '  ✘ Pushing the image · 0.1s',
      '    ✘ Uploading · 0.1s',
    ],
  ],
  [
    'warn',
    (line) => line.warn('Deployed with problems'),
    [
      '⚠ Deployed with problems · 0.1s',
      '  ✔ Built the image · 0.1s',
      '  ⚠ Pushing the image · 0.1s',
      '    ⚠ Uploading · 0.1s',
    ],
  ],
])(
  "a parent's %s keeps its tasks under it, and its open tasks take its end",
  async (_name, end, rows) => {
    const outcome = await grouped(async (context, { tick }) => {
      const deploying = progress(context, { label: 'Deploying' });
      const building = deploying.task({ label: 'Building the image' });
      const pushing = deploying.task({ label: 'Pushing the image' });
      pushing.task({ label: 'Uploading' });
      tick();
      await building.end('Built the image');
      await end(deploying);
    });
    const screen = await shown(outcome);
    expect(screen).toEqual(rows);
    expect(repeated(screen)).toEqual([]);
  },
);

test.each<[string, (line: Progress) => Promise<void>, readonly string[]]>([
  ['end', (line) => line.end('Deployed'), ['✔ Deployed', '  ✔ Pushing', '    ✔ Uploading']],
  ['skip', (line) => line.skip('Skipped'), ['ℹ Skipped', '  ℹ Pushing', '    ℹ Uploading']],
])(
  'with keepTasks, a %s on the parent shows the end each open task took, with its own label',
  async (_name, end, rows) => {
    const outcome = await grouped(async (context) => {
      const deploying = progress(context, { keepTasks: true, label: 'Deploying' });
      const pushing = deploying.task({ keepTasks: true, label: 'Pushing' });
      pushing.task({ label: 'Uploading' });
      await end(deploying);
    });
    const screen = await shown(outcome);
    expect(screen.map((row) => row.replace(/ · \d+\.\ds$/u, ''))).toEqual(rows);
  },
);

test('a cancelled run keeps the tree under the cancelled root, every open task cancelled', async () => {
  const outcome = await grouped(async (context, { cancel, tick }) => {
    const deploying = progress(context, { label: 'Deploying' });
    const building = deploying.task({ label: 'Building the image' });
    deploying.task({ label: 'Pushing the image' });
    tick();
    await building.end('Built the image');
    cancel();
    await flush();
  });
  expect(outcome.code).toBe(130);
  await expect(shown(outcome)).resolves.toEqual([
    '■ Deploying (cancelled)',
    '  ✔ Built the image · 0.1s',
    '  ■ Pushing the image (cancelled)',
  ]);
});

test('a failing run writes the kept tree above the failure report', async () => {
  const outcome = await grouped(async (context) => {
    const deploying = progress(context, { label: 'Deploying' });
    await deploying.task({ label: 'Building the image' }).end('Built the image');
    deploying.task({ label: 'Pushing the image' });
    throw new FatalError('The registry refused the push. Sign in, then retry.');
  });
  expect(outcome.code).toBe(1);
  const rows = await shown(outcome);
  // The run fails after the action, where the clock is real again, so the open lines' time is not fixed.
  expect(rows[0]).toMatch(/^✘ Deploying · /u);
  expect(rows[1]).toBe('  ✔ Built the image · 0.0s');
  expect(rows[2]).toMatch(/^ {2}✘ Pushing the image · /u);
  expect(rows[3]).toBe('The registry refused the push. Sign in, then retry.');
});

test('an action that returns with a tree open ends it as a success, so its tasks collapse', async () => {
  const outcome = await grouped(async (context) => {
    const deploying = progress(context, { label: 'Deploying' });
    deploying.task({ label: 'Building the image' });
  });
  const rows = await shown(outcome);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatch(/^✔ Deploying · /u);
});

test('a nested group that fails while its root runs keeps its tasks in place in the frame', async () => {
  const outcome = await grouped(async (context, { mark }) => {
    const deploying = progress(context, { label: 'Deploying' });
    const building = deploying.task({ label: 'Building' });
    await building.task({ label: 'Compiling' }).fail();
    building.task({ label: 'Linking' });
    await building.fail();
    deploying.task({ label: 'Pushing' });
    await mark('running');
  });
  await expect(shown(outcome, 'running')).resolves.toEqual([
    '◐ Deploying · 0.0s',
    '  ✘ Building · 0.0s',
    '    ✘ Compiling · 0.0s',
    '    ✘ Linking · 0.0s',
    '  ◐ Pushing · 0.0s',
  ]);
  expect(outline(lastRunning(outcome))).toEqual([
    'running Deploying',
    '  failed Building',
    '    failed Compiling',
    '    failed Linking',
    '  running Pushing',
  ]);
});

test('a nested group that succeeds collapses in place while its root runs', async () => {
  const outcome = await grouped(async (context, { mark }) => {
    const deploying = progress(context, { label: 'Deploying' });
    const building = deploying.task({ label: 'Building' });
    await building.task({ label: 'Compiling' }).fail();
    building.task({ label: 'Linking' });
    await building.end('Built');
    await mark('running');
  });
  await expect(shown(outcome, 'running')).resolves.toEqual([
    '◐ Deploying · 0.0s',
    '  ✔ Built · 0.0s',
  ]);
});

test('clear() on a parent removes the whole tree, and its open tasks report ended first', async () => {
  const outcome = await grouped(async (context, { mark }) => {
    await context.out.info('lane line');
    const deploying = progress(context, { label: 'Deploying' });
    const building = deploying.task({ label: 'Building' });
    building.task({ label: 'Compiling' });
    await mark('running');
    await deploying.clear();
  });
  await expect(shown(outcome)).resolves.toEqual(['ℹ lane line']);
  const cleared = await grouped(
    async (context) => {
      const deploying = progress(context, { label: 'Deploying' });
      deploying.task({ label: 'Building' }).task({ label: 'Compiling' });
      await deploying.clear();
    },
    { terminal: 'invoke' },
  );
  expect(eventsOf(cleared)).toEqual([
    [1, 'started', 'Deploying'],
    [2, 'started', 'Building'],
    [3, 'started', 'Compiling'],
    [3, 'ended', 'Compiling'],
    [2, 'ended', 'Building'],
    [1, 'ended', 'Deploying'],
  ]);
});

test("a task's log rows draw under it, two columns further in", async () => {
  const outcome = await grouped(async (context, { mark, tick }) => {
    const deploying = progress(context, { label: 'Deploying' });
    const pushing = deploying.task({ label: 'Pushing the image', total: 3 });
    await pushing.log('Pushed layer sha256:4f1c');
    pushing.update({ completed: 1 });
    pushing.task({ label: 'Uploading' });
    tick();
    await mark('running');
  });
  await expect(shown(outcome, 'running')).resolves.toEqual([
    '◐ Deploying · 0.1s',
    '  ◐ Pushing the image ▰▰▰▱▱▱▱▱▱▱ 1/3 · 0.1s',
    '    Pushed layer sha256:4f1c',
    '    ◐ Uploading · 0.1s',
  ]);
});

test("a failed task's kept lines wait, and are written directly above its end line when the tree stays", async () => {
  const outcome = await grouped(async (context, { mark, tick }) => {
    const deploying = progress(context, { label: 'Deploying' });
    const building = deploying.task({ label: 'Building' });
    await building.log('tsc error TS2304');
    const linking = building.task({ label: 'Linking' });
    await linking.log('ld: symbol not found');
    await linking.fail();
    await mark('linking');
    await building.fail();
    await deploying.log('registry unreachable');
    tick();
    await mark('building');
    await deploying.fail();
  });
  await expect(shown(outcome, 'linking')).resolves.toEqual([
    '◐ Deploying · 0.0s',
    '  ◐ Building · 0.0s',
    '    tsc error TS2304',
    '    ✘ Linking · 0.0s',
  ]);
  await expect(shown(outcome, 'building')).resolves.toEqual([
    '◐ Deploying · 0.1s',
    '  registry unreachable',
    '  ✘ Building · 0.0s',
    '    ✘ Linking · 0.0s',
  ]);
  const rows = await shown(outcome);
  expect(rows).toEqual([
    '  registry unreachable',
    '✘ Deploying · 0.1s',
    '    tsc error TS2304',
    '  ✘ Building · 0.0s',
    '      ld: symbol not found',
    '    ✘ Linking · 0.0s',
  ]);
  expect(repeated(rows)).toEqual([]);
});

test("a group's later success discards its failed task's kept lines with it", async () => {
  const outcome = await grouped(async (context) => {
    const deploying = progress(context, { label: 'Deploying' });
    const building = deploying.task({ label: 'Building' });
    await building.log('retrying after a timeout');
    await building.fail();
    await deploying.end('Deployed');
  });
  await expect(shown(outcome)).resolves.toEqual(['✔ Deployed · 0.0s']);
  expect(outcome.stderr).not.toContain('retrying');
});

test('a tree on a short terminal draws no frame taller than the terminal, its oldest finished rows giving way first', async () => {
  const outcome = await grouped(
    async (context, { mark, tick }) => {
      const deploying = progress(context, { label: 'Deploying' });
      for (const name of ['one', 'two', 'three', 'four']) {
        const step = deploying.task({ label: `Step ${name}` });
        tick();
        await step.end(`Did ${name}`);
      }
      const pushing = deploying.task({ label: 'Pushing' });
      await pushing.log(['a', 'b', 'c', 'd', 'e', 'f'].map((row) => `log ${row}`).join('\n'));
      tick();
      await mark('running');
      await pushing.fail();
      tick();
      await mark('pushed');
      await deploying.fail();
    },
    { rows: 8 },
  );
  for (const frame of outcome.frames) {
    expect(frame.text.split('\n').length).toBeLessThanOrEqual(8);
  }
  const running = await shown(outcome, 'running');
  expect(running.slice(-8)).toEqual([
    '◐ Deploying · 0.5s',
    '  ✔ Did four · 0.1s',
    '  ◐ Pushing · 0.1s',
    '    log b',
    '    log c',
    '    log d',
    '    log e',
    '    log f',
  ]);
  expect(repeated(running)).toEqual([]);
  const pushed = await shown(outcome, 'pushed');
  expect(pushed.slice(-6)).toEqual([
    '◐ Deploying · 0.6s',
    '  ✔ Did one · 0.1s',
    '  ✔ Did two · 0.1s',
    '  ✔ Did three · 0.1s',
    '  ✔ Did four · 0.1s',
    '  ✘ Pushing · 0.1s',
  ]);
  const rows = await shown(outcome);
  expect(repeated(rows)).toEqual([]);
  expect(rows.slice(-12)).toEqual([
    '✘ Deploying · 0.6s',
    '  ✔ Did one · 0.1s',
    '  ✔ Did two · 0.1s',
    '  ✔ Did three · 0.1s',
    '  ✔ Did four · 0.1s',
    '    log a',
    '    log b',
    '    log c',
    '    log d',
    '    log e',
    '    log f',
    '  ✘ Pushing · 0.1s',
  ]);
});

test("a kept tree is written whole when every finished row gave way to the terminal's height", async () => {
  const outcome = await grouped(
    async (context, { mark }) => {
      const deploying = progress(context, { label: 'Deploying' });
      await deploying.log(['a', 'b', 'c'].map((row) => `log ${row}`).join('\n'));
      await deploying.task({ label: 'Building' }).end('Built');
      await deploying.task({ label: 'Pushing' }).fail();
      await mark('running');
      await deploying.fail();
    },
    { rows: 3 },
  );
  await expect(shown(outcome, 'running')).resolves.toEqual([
    '◐ Deploying · 0.0s',
    '  log b',
    '  log c',
  ]);
  const rows = await shown(outcome);
  expect(rows.slice(-6)).toEqual([
    '  log a',
    '  log b',
    '  log c',
    '✘ Deploying · 0.0s',
    '  ✔ Built · 0.0s',
    '  ✘ Pushing · 0.0s',
  ]);
});

/** The script every not-live case runs: three levels, ends out of order, and a parent's end that an open task takes. */
async function outOfOrder(context: ActionContext<unknown>): Promise<void> {
  const deploying = progress(context, { label: 'Deploying' });
  const building = deploying.task({ label: 'Building the image' });
  const compiling = building.task({ label: 'Compiling' });
  const pushing = deploying.task({ label: 'Pushing the image' });
  await compiling.end('Compiled');
  await pushing.log('npm error code E404');
  await pushing.fail();
  deploying.task({ label: 'Cleaning up' });
  await deploying.warn('Deployed with problems');
}

/** What `outOfOrder` writes where the tree does not draw. */
const plainLines = [
  'ℹ Deploying',
  '  ℹ Building the image',
  '    ℹ Compiling',
  '  ℹ Pushing the image',
  '    ✔ Compiled',
  '    npm error code E404',
  '  ✘ Pushing the image',
  '  ℹ Cleaning up',
  '  ⚠ Building the image',
  '  ⚠ Cleaning up',
  '⚠ Deployed with problems',
  '',
].join('\n');

test.each([
  { name: 'piped', setup: { terminal: 'pipe' } },
  { name: 'under TERM=dumb', setup: { env: { TERM: 'dumb' } } },
  { name: 'under CI', setup: { env: { CI: 'true' } } },
  { name: 'with --plain', setup: { argv: ['--plain'] } },
] as const)(
  '$name, each line writes its plain lines when they happen, indented',
  async ({ setup }) => {
    const outcome = await grouped(outOfOrder, setup);
    expect(outcome.stderr).toBe(plainLines);
    expect(outcome.frames).toEqual([]);
  },
);

test('under -q only the failed and warned lines and the kept lines print, indented', async () => {
  const outcome = await grouped(outOfOrder, { argv: ['-q'] });
  expect(outcome.stderr).toBe(
    [
      '    npm error code E404',
      '  ✘ Pushing the image',
      '  ⚠ Building the image',
      '  ⚠ Cleaning up',
      '⚠ Deployed with problems',
      '',
    ].join('\n'),
  );
});

test('under app.invoke the same lines land in messages', async () => {
  const outcome = await grouped(outOfOrder, { terminal: 'invoke' });
  expect(outcome.messages).toBe(plainLines);
});

test("piped, a task's long line wraps nowhere, and its continuation lines keep the indent", async () => {
  const outcome = await grouped(
    async (context) => {
      const deploying = progress(context, { label: 'Deploying' });
      await deploying.task({ label: 'Building\nthe image' }).end();
      await deploying.end();
    },
    { terminal: 'pipe' },
  );
  expect(outcome.stderr).toBe(
    'ℹ Deploying\n  ℹ Building\n    the image\n  ✔ Building\n    the image\n✔ Deploying\n',
  );
});

test("piped, a failing run writes the open tasks' failure lines before the root's, and a cancellation writes no end line", async () => {
  const failing = await grouped(
    async (context) => {
      const deploying = progress(context, { label: 'Deploying' });
      deploying.task({ label: 'Building' }).task({ label: 'Compiling' });
      throw new FatalError('The build failed. Fix the errors above, then deploy again.');
    },
    { terminal: 'pipe' },
  );
  expect(failing.stderr).toBe(
    [
      'ℹ Deploying',
      '  ℹ Building',
      '    ℹ Compiling',
      '    ✘ Compiling',
      '  ✘ Building',
      '✘ Deploying',
      'The build failed. Fix the errors above, then deploy again.',
      '',
    ].join('\n'),
  );
  const cancelled = await grouped(
    async (context, { cancel }) => {
      const deploying = progress(context, { label: 'Deploying' });
      const building = deploying.task({ label: 'Building' });
      await building.log('half built');
      cancel();
      await flush();
    },
    { terminal: 'pipe' },
  );
  expect(cancelled.stderr).toBe('ℹ Deploying\n  ℹ Building\n    half built\n');
});

test('track() on a task returns the value and ends the task, and rethrows a rejection after failing it', async () => {
  const thrown = new Error('no space');
  const outcome = await grouped(
    async (context) => {
      const deploying = progress(context, { label: 'Deploying' });
      await expect(
        deploying.task({ label: 'Building' }).track(Promise.resolve(3), {
          done: (count) => `Built ${String(count)} layers`,
        }),
      ).resolves.toBe(3);
      await expect(
        deploying
          .task({ label: 'Pushing' })
          .track(Promise.reject(thrown), { failed: 'Pushed nothing' }),
      ).rejects.toBe(thrown);
      await deploying.end();
    },
    { terminal: 'pipe' },
  );
  expect(outcome.stderr).toBe(
    'ℹ Deploying\n  ℹ Building\n  ✔ Built 3 layers\n  ℹ Pushing\n  ✘ Pushed nothing\n✔ Deploying\n',
  );
});

test.each<[string, (line: Progress) => Promise<void>]>([
  ['ended', (line) => line.end()],
  ['failed', (line) => line.fail()],
  ['skipped', (line) => line.skip()],
  ['warned', (line) => line.warn()],
  ['cleared', (line) => line.clear()],
])('task() on a line that %s returns a task that has ended too', async (_name, end) => {
  const thrown = new Error('late work');
  const outcome = await grouped(
    async (context) => {
      const deploying = progress(context, { label: 'Deploying' });
      await end(deploying);
      const late = deploying.task({ label: 'Too late' });
      late.update({ completed: 1, label: 'Still too late', total: 2 });
      await expect(late.log('a line')).resolves.toBeUndefined();
      await expect(late.track(Promise.resolve(7))).resolves.toBe(7);
      await expect(late.track(Promise.reject(thrown))).rejects.toBe(thrown);
      await late.end();
      await late.fail();
      await late.skip();
      await late.warn();
      await late.clear();
      await late.task({ label: 'Later still' }).end();
    },
    { terminal: 'invoke' },
  );
  expect(outcome.progress.map(({ label }) => label)).not.toContain('Too late');
  expect(outcome.progress.map(({ id }) => id)).toEqual([1, 1]);
  expect(outcome.messages).not.toContain('late');
});

test('task() on a task that has ended returns a task that has ended too', async () => {
  const outcome = await grouped(
    async (context) => {
      const deploying = progress(context, { label: 'Deploying' });
      const building = deploying.task({ label: 'Building' });
      await building.end();
      await building.task({ label: 'Too late' }).end();
      await deploying.end();
    },
    { terminal: 'pipe' },
  );
  expect(outcome.stderr).toBe('ℹ Deploying\n  ℹ Building\n  ✔ Building\n✔ Deploying\n');
});

test('each task reports one start and one end under its own label, its open tasks ending before it', async () => {
  const outcome = await grouped(
    async (context) => {
      const deploying = progress(context, { label: 'Deploying' });
      const building = deploying.task({ label: 'Building', total: 2 });
      building.update({ completed: 1 });
      building.task({ label: 'Compiling' });
      deploying.task({ label: 'Pushing' });
      await deploying.fail('Deploy failed');
    },
    { terminal: 'invoke' },
  );
  expect(eventsOf(outcome)).toEqual([
    [1, 'started', 'Deploying'],
    [2, 'started', 'Building'],
    [2, 'updated', 'Building'],
    [3, 'started', 'Compiling'],
    [4, 'started', 'Pushing'],
    [3, 'failed', 'Compiling'],
    [2, 'failed', 'Building'],
    [4, 'failed', 'Pushing'],
    [1, 'failed', 'Deploy failed'],
  ]);
});

test("under core's close the root's end event comes first, then each open task's in opening order", async () => {
  const outcome = await grouped(
    async (context) => {
      const deploying = progress(context, { label: 'Deploying' });
      deploying.task({ label: 'Building' }).task({ label: 'Compiling' });
      deploying.task({ label: 'Pushing' });
      throw new FatalError('The deploy failed. Fix the errors above, then deploy again.');
    },
    { terminal: 'invoke' },
  );
  expect(eventsOf(outcome).slice(4)).toEqual([
    [1, 'failed', 'Deploying'],
    [2, 'failed', 'Building'],
    [3, 'failed', 'Compiling'],
    [4, 'failed', 'Pushing'],
  ]);
  expect(outcome.messages).toBe(
    [
      'ℹ Deploying',
      '  ℹ Building',
      '    ℹ Compiling',
      '  ℹ Pushing',
      '    ✘ Compiling',
      '  ✘ Building',
      '  ✘ Pushing',
      '✘ Deploying',
      'The deploy failed. Fix the errors above, then deploy again.',
      '',
    ].join('\n'),
  );
});

test('every frame carries depth and tasks, and an override draws the tree it chooses from them', async () => {
  const outcome = await grouped(
    async (context, { mark }) => {
      const deploying = progress(context, { label: 'Deploying' });
      const building = deploying.task({ label: 'Building' });
      building.task({ label: 'Compiling' });
      await mark('running');
    },
    {
      render: (data) => listed(data).join('\n'),
    },
  );
  await expect(shown(outcome, 'running')).resolves.toEqual([
    'Deploying (0)',
    '- Building (1)',
    '-- Compiling (2)',
  ]);
  for (const { data } of outcome.frames) {
    expect(data.depth).toBe(0);
    expect(data.tasks).toBeDefined();
  }
});

test('the default view draws hand-built data without depth or tasks as one line, and with them as a tree', async () => {
  const mock = mockProcess({ env: noColor });
  const base = progressData();
  await new Application('rows', { description: 'Draw progress data.' })
    .action(async ({ out }) => {
      await out.draw(base, progressLine);
      await out.draw('\n', { render: (text: string) => text });
      await out.draw(
        {
          ...base,
          tasks: [
            { ...base, depth: 1, label: 'Built', log: ['a log row'], state: 'ended' },
            {
              ...base,
              depth: 1,
              label: 'Pushing',
              tasks: [{ ...base, depth: 2, label: 'Uploading' }],
            },
          ],
        },
        progressLine,
      );
      await out.draw('\n', { render: (text: string) => text });
    })
    .run({ process: mock });
  expect(mock.stderr.text).toBe(
    [
      '* Work · 0.0s',
      '* Work · 0.0s',
      '  ✔ Built · 0.0s',
      '    a log row',
      '  * Pushing · 0.0s',
      '    * Uploading · 0.0s',
      '',
    ].join('\n'),
  );
});

/** The data of the last running frame the root drew. */
function lastRunning(outcome: Outcome): ProgressLine {
  const running = outcome.frames.filter(({ data }) => data.state === 'running');
  return running[running.length - 1]?.data ?? progressData();
}

/** A tree an override draws as a list: each line's label and depth after a dash for each level. */
function listed(data: ProgressLine): string[] {
  const depth = data.depth ?? 0;
  const mark = depth === 0 ? '' : `${'-'.repeat(depth)} `;
  return [
    `${mark}${data.label} (${String(depth)})`,
    ...(data.tasks ?? []).flatMap((task) => listed(task)),
  ];
}

/** A running line's data as an application builds it by hand, without `depth` or `tasks`. */
function progressData(): ProgressLine {
  return {
    bar: { complete: '#', incomplete: '-' },
    completed: undefined,
    elapsed: 0,
    frame: '*',
    label: 'Work',
    state: 'running',
    total: undefined,
  };
}

test('a task that opens when the stack has no row left makes the line beside it shrink first', async () => {
  const outcome = await grouped(
    async (context, { mark, tick }) => {
      const watching = progress(context, { label: 'Watching' });
      await watching.log(['a', 'b', 'c', 'd', 'e', 'f'].map((row) => `log ${row}`).join('\n'));
      tick();
      const deploying = progress(context, { label: 'Deploying' });
      deploying.task({ label: 'Building' });
      await mark('opened');
    },
    { rows: 6 },
  );
  const rows = await shown(outcome, 'opened');
  expect(repeated(rows)).toEqual([]);
  expect(rows.slice(-6)).toEqual([
    '◐ Watching · 0.1s',
    '  log d',
    '  log e',
    '  log f',
    '◐ Deploying · 0.0s',
    '  ◐ Building · 0.0s',
  ]);
});
