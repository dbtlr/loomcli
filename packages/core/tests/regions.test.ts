/*
 * Acceptance plan for the live region (docs/core/output.md#live-region).
 *
 * The live region is proven when public APIs alone produce these results under Node and Bun,
 * against a headless terminal emulator fed what core writes to a host whose stderr reports a
 * terminal:
 *
 * - The stack. Two regions draw, an `out.info` and an `out.debug` at verbosity 1 between their
 *   frames land above both, and the screen holds both frames below them in open order. A frame that
 *   grows by a row moves the region below it down. Closing the top region moves its last frame into
 *   scrollback above the other region, and a region whose last frame is empty leaves no row. An
 *   `out.draw` that writes `partial` with no line break before the first region draws leaves
 *   `partial` on its own row above the frame.
 * - Stdout. With stdout a terminal too, a result written while a region is drawn lands above the
 *   stack. With stdout piped, stdout receives the result alone and stderr's stack is untouched.
 * - Out of core. A fixture `onLog` hook that writes to its destination's `stderr` while a region is
 *   drawn lands above the stack.
 * - Input regions. A region redrawn on a timer stops changing while an input region is open and
 *   shows its latest frame once when the input region closes, and a region that closed meanwhile is
 *   in scrollback above the input region's last frame. A second input region's first draw resolves
 *   only after the first input region closes.
 * - The signal. `end()`, the action's return, a thrown failure, and the run's cancellation each
 *   abort the signal with `closedBy` `'end'`, `'completion'`, `'failure'`, and `'cancellation'`,
 *   and a frame an abort listener draws is the region's last frame. A failed run's report follows
 *   every region's last frame, from an action, a middleware, and a configuration source. A
 *   cancelled run writes no report. A second input region still waiting when the run is cancelled
 *   reads `closedBy` `'cancellation'`. A region a middleware opens before `next()` is still open,
 *   with `closedBy` `undefined`, after the action returns, and reads `'completion'` once the chain
 *   has unwound; a region a middleware opens after `next()` reads `'completion'` too, and a region
 *   a configuration source opens reads `closedBy` `'completion'` after `--help` takes over.
 * - Not live. `live` reads `false` with stderr piped, under `app.invoke` and an action's `invoke`,
 *   and at verbosity -1 for a region without `input: true`. Its `draw` calls no override of its
 *   view and writes nothing. An input region at verbosity -1 on a terminal reads `true` and draws.
 *   On a terminal stderr whose `TERM` is `dumb`, or with `CI` set, a region without `input: true`
 *   reads `false` and an input region reads `true`, and with `CI` empty a region reads `true`.
 *   There, `out.draw` keeps the Application's `terminalControls` setting, so a cursor movement
 *   its text holds is dropped, while on a terminal that redraws the movement is kept.
 *   A signal that ends a run there writes no control sequence, so no cursor is shown that nothing
 *   hid, unless the Application preserves terminal controls, when it shows the cursor again.
 * - Resize. A two-row frame drawn at 80 columns, after the emulator is resized to 40 columns and
 *   reflows, is erased whole by the next draw, and no stale row remains.
 * - `out.draw`. Its count is unchanged for every frame the prompts acceptance once pinned, its text
 *   lands above an open region, it draws at verbosity -1, and off a terminal its bytes are
 *   unchanged.
 * - After close. `draw`, `end`, and `report` on a closed region do nothing and resolve.
 * - Faults. The negative type checks reject the calls the types forbid.
 */

import { Application } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { replay, until } from '../../../scripts/test-screen.js';
import type { Recorded } from '../../../scripts/test-screen.js';

const fixture = new URL('fixtures/regions.mjs', import.meta.url);

interface Run {
  code: number | string;
  events: Recorded[];
  messages?: string;
  notes: Record<string, unknown>;
  stdout: string;
}

/** One run of a scenario on a terminal, `tty` unless named, with the command line after it. */
function regions(scenario: string, terminal = 'tty', argv: string[] = []): Run {
  const result = invoke(fixture, [scenario, terminal, ...argv], {
    env: { FORCE_COLOR: undefined, NO_COLOR: '1', TERM: 'xterm' },
  });
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

/** The rows the emulator shows once it has taken every event up to the mark, or all of them. */
async function screen(run: Run, mark?: string): Promise<readonly string[]> {
  const shown = await replay(until(run.events, mark), { columns: 40 });
  return shown.lines;
}

/** Every byte written, in order. */
function written(run: Run): string {
  return run.events.map((event) => ('write' in event ? event.write : '')).join('');
}

test('two regions stack in open order below a lane line and a debug line written between their frames', async () => {
  const run = regions('stack', 'tty', ['-v']);
  await expect(screen(run, 'lines')).resolves.toEqual([
    'ℹ info line',
    '› debug line',
    'first frame',
    'second frame',
  ]);
});

test('a frame that grows by a row moves the region below it down', async () => {
  const run = regions('stack', 'tty', ['-v']);
  await expect(screen(run, 'grown')).resolves.toEqual([
    'ℹ info line',
    '› debug line',
    'first frame',
    'first grown row',
    'second frame',
  ]);
});

test('closing the top region moves its last frame into scrollback above the others', async () => {
  const run = regions('close');
  await expect(screen(run, 'top closed')).resolves.toEqual([
    'first frame',
    'second frame',
    'third frame',
  ]);
});

test('a region whose last frame is empty leaves no row when it closes', async () => {
  const shown = await replay(until(regions('close').events, 'empty closed'), { columns: 40 });
  expect(shown.lines).toEqual(['first frame', 'second frame']);
  expect(shown.cursor).toEqual({ column: 'second frame'.length, row: 1 });
});

test('a partial line drawn before the first region draws stays on its own row above the frame', async () => {
  await expect(screen(regions('partial'), 'drawn')).resolves.toEqual(['partial', 'frame']);
});

test('with stdout a terminal too, a printed line lands above the region', async () => {
  await expect(screen(regions('stdout', 'both'), 'printed')).resolves.toEqual([
    'printed',
    'frame again',
  ]);
});

test('with stdout a terminal too, a partial line rendered to stdout before the first region draws stays on its own row', async () => {
  await expect(screen(regions('partialStdout', 'both'), 'drawn')).resolves.toEqual([
    'partial',
    'frame two',
  ]);
});

test('with stdout a terminal too, a whole line printed after a partial stderr line leaves no blank row above the first region', async () => {
  await expect(screen(regions('printedAfterPartial', 'both'), 'drawn')).resolves.toEqual([
    'partialprinted',
    'frame',
  ]);
});

test('with stdout piped, stdout holds the printed line alone and the region is untouched', async () => {
  const run = regions('stdout', 'tty');
  expect(run.stdout).toBe('printed\n');
  await expect(screen(run, 'printed')).resolves.toEqual(['frame again']);
});

test("an onLog hook's write to its destination's stderr lands above the region", async () => {
  await expect(screen(regions('hook'), 'logged')).resolves.toEqual(['hook heard', 'frame again']);
});

test('records an onLog hook writes at once land above a lane line written after them, in call order', async () => {
  await expect(screen(regions('burst'), 'logged')).resolves.toEqual([
    'hook one',
    'hook two',
    'hook three',
    'ℹ lane',
    'frame',
  ]);
});

test('an input region holds the other regions still while it is open', async () => {
  await expect(screen(regions('input'), 'frozen')).resolves.toEqual([
    'tick 0',
    'closing frame',
    'question',
  ]);
});

test('when an input region closes, a region that closed meanwhile is above its last frame and the others catch up', async () => {
  await expect(screen(regions('input'), 'released')).resolves.toEqual([
    'closing last',
    'answered',
    'tick 2',
    'second question',
  ]);
});

test("a second input region's first draw resolves only after the first input region closes", () => {
  expect(regions('input').notes).toMatchObject({
    openedAfterClose: true,
    openedBeforeClose: false,
  });
});

test("end() and the action's return close regions as end and completion", async () => {
  const run = regions('signals');
  expect(run.notes).toEqual({ completion: 'completion', end: 'end' });
  await expect(screen(run)).resolves.toEqual(['ending', 'completed by core']);
});

test('a failure closes every region before the report, which follows each last frame', async () => {
  const run = regions('failure');
  expect(run.code).toBe(1);
  expect(run.notes).toEqual({ failure: 'failure', middleware: 'failure', source: 'failure' });
  // The action's regions close as it settles, as they do when it returns, and the others before the report.
  await expect(screen(run)).resolves.toEqual([
    'action failed frame',
    'action frame',
    'source failed frame',
    'middleware failed frame',
    'It failed.',
  ]);
});

test('cancellation closes every region, a waiting input region included, and writes no report', async () => {
  const run = regions('cancel');
  expect(run.code).toBe(130);
  expect(run.notes).toEqual({ cancellation: 'cancellation', waiting: 'cancellation' });
  await expect(screen(run)).resolves.toEqual(['cancelled frame', 'question']);
});

test("a region opened after the run's cancellation closes with cancellation as it opens", () => {
  expect(regions('late').notes).toEqual({ late: 'cancellation' });
});

test('a region a middleware opens before next() stays open through the action and closes once the chain unwinds', () => {
  expect(regions('middleware').notes).toEqual({
    action: 'completion',
    actionAfterNext: 'completion',
    after: 'completion',
    before: 'completion',
    beforeAfterNext: 'open',
  });
});

test('a region a configuration source opens closes with completion after --help takes over', () => {
  expect(regions('takeover', 'tty', ['--help']).notes).toEqual({ source: 'completion' });
});

test.each([
  ['a stderr that is not a terminal', 'pipe', []],
  ['an invocation by name', 'invoke', []],
  ["an action's invoke at a terminal", 'nested', []],
])('a region is not live under %s, and its draw calls no view', (_case, terminal, argv) => {
  const run = regions('live', terminal, argv);
  expect(run.notes).toEqual({ calls: 0, inputLive: false, live: false });
  expect(written(run)).toBe('');
});

test('at verbosity -1 a region without input is not live, and an input region still draws', async () => {
  const run = regions('live', 'tty', ['-q']);
  expect(run.notes).toEqual({ calls: 1, inputLive: true, live: false });
  await expect(screen(run)).resolves.toEqual(['input frame']);
});

test.each([
  { env: { TERM: 'dumb' }, input: true, live: false },
  { env: { CI: 'true' }, input: true, live: false },
  { env: { CI: '' }, input: true, live: true },
])(
  'on a terminal stderr with $env, a region reads live $live and an input region $input',
  async ({ env, input, live }) => {
    const seen: Record<string, boolean> = {};
    const app = new Application('regions').action(({ out }) => {
      seen.live = out.region().live;
      seen.input = out.region({ input: true }).live;
    });
    const mock = mockProcess({
      env: { TERM: 'xterm', ...env },
      terminal: { columns: 40, rows: 24, streams: ['stderr'] },
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(seen).toEqual({ input, live });
  },
);

test.each([
  { env: { TERM: 'xterm' }, text: '\u001B[1Aup' },
  { env: { TERM: 'dumb' }, text: 'up' },
  { env: { CI: 'true' }, text: 'up' },
])('on a terminal stderr with $env, out.draw writes $text', async ({ env, text }) => {
  const app = new Application('regions').action(async ({ out }) => {
    await out.draw(undefined, { render: () => '\u001B[1Aup' });
  });
  const mock = mockProcess({
    env: { TERM: 'xterm', ...env },
    terminal: { columns: 40, rows: 24, streams: ['stderr'] },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toBe(text);
});

test.each([
  { env: { TERM: 'dumb' }, preserve: false, text: 'ℹ working\n' },
  { env: { CI: 'true' }, preserve: false, text: 'ℹ working\n' },
  { env: { TERM: 'dumb' }, preserve: true, text: 'ℹ working\n\u001B[?25h' },
])(
  'on a terminal stderr with $env, preserving controls $preserve, a signal that ends the run writes $text',
  async ({ env, preserve, text }) => {
    const ready = Promise.withResolvers<void>();
    const rendering = preserve ? { terminalControls: 'preserve' as const } : {};
    const app = new Application('regions', { rendering }).action(async ({ out, signal }) => {
      await out.info('working');
      ready.resolve();
      await new Promise((resolve) => {
        signal.addEventListener('abort', resolve, { once: true });
      });
    });
    const mock = mockProcess({
      env: { TERM: 'xterm', ...env },
      terminal: { columns: 40, rows: 24, streams: ['stderr'] },
    });
    const running = app.run({ process: mock });
    await ready.promise;
    mock.signals.raise('SIGINT');
    await expect(running).resolves.toBe(130);
    // The shutdown ends, and restores the terminal, on the turn after the run resolves.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect([mock.endedBy, mock.stderr.text]).toEqual(['SIGINT', text]);
  },
);

test('a reflowing resize leaves no stale row when the region redraws', async () => {
  const shown = await replay(until(regions('resize').events), { columns: 80 });
  expect(shown.lines).toEqual(['after']);
});

test('out.draw lands above an open region and keeps its count', async () => {
  const run = regions('draw');
  expect(run.notes).toEqual({ count: 1 });
  await expect(screen(run, 'drawn')).resolves.toEqual(['drawn', 'row', 'frame']);
});

test('a two-row out.draw frame redrawn by its count above an open region leaves only its last frame', async () => {
  await expect(screen(regions('redraw'), 'redrawn')).resolves.toEqual([
    'frame 3 top',
    'frame 3 bottom',
    'progress line',
  ]);
});

test('an info line after a partial out.draw continues its row above an open region', async () => {
  await expect(screen(regions('partialInfo'), 'written')).resolves.toEqual([
    'partialℹ done',
    'frame',
  ]);
});

test('an info line after an out.draw that fills its row starts on the row below, above an open region', async () => {
  await expect(screen(regions('fullInfo'), 'written')).resolves.toEqual([
    'x'.repeat(40),
    'ℹ done',
    'frame',
  ]);
});

test('with stdout a terminal too, unawaited print, info, and print calls land above the region in call order', async () => {
  await expect(screen(regions('ordered', 'both'), 'written')).resolves.toEqual([
    'first',
    'ℹ second',
    'third',
    'frame',
  ]);
});

test('with stdout a terminal too, a print issued behind an unawaited row sequence lands after its rows, and an info line issued then is not held behind them', async () => {
  await expect(screen(regions('orderedRows', 'both'), 'written')).resolves.toEqual([
    'ℹ noted',
    'row one',
    'row two',
    'after rows',
    'frame',
  ]);
});

test('with stdout a terminal too, a row source that awaits an info line ends its run while a print waits behind its rows', async () => {
  const run = regions('reported', 'both');
  expect(run.code).toBe(0);
  await expect(screen(run, 'written')).resolves.toEqual([
    'row one',
    'ℹ fetching page two',
    'row two',
    'after rows',
  ]);
});

test('with stdout a terminal too, a row source that awaits an info line above an open region ends its run while a print waits behind its rows', async () => {
  const run = regions('reportedRegion', 'both');
  expect(run.code).toBe(0);
  await expect(screen(run, 'written')).resolves.toEqual([
    'row one',
    'ℹ fetching page two',
    'row two',
    'after rows',
    'frame',
  ]);
});

test('out.draw draws at verbosity -1, where a region without input does not', async () => {
  const run = regions('draw', 'tty', ['-q']);
  expect(run.notes).toEqual({ count: 1 });
  await expect(screen(run, 'drawn')).resolves.toEqual(['drawn', 'row']);
});

test('draw, end, and report on a closed region do nothing and resolve', async () => {
  const run = regions('closed');
  expect(run.notes).toEqual({ calls: 0, closedBy: 'end' });
  await expect(screen(run)).resolves.toEqual(['frame']);
});
