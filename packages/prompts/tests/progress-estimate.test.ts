/*
 * Acceptance plan for a progress line's rate and time left (docs/libs/prompts.md#rate-and-time-left,
 * ADR-0171). Each line runs in an application on a mock terminal, its clock and its frame timer
 * faked inside the action, so a report lands at a stated millisecond and a timer frame draws only
 * when the test moves the clock. An override of the progress view notes each frame's data and the
 * default view's text for it.
 *
 * - The worked sequence. Reports of 1, 10, 40, 70, and 100 of 120 at 500, 3000, 12 000, 13 000,
 *   and 14 000 milliseconds draw the rates and times left the reference's table states, the first
 *   report showing neither part, and the rate following the faster work once the anchor moves.
 * - Counting down. Timer frames between reports count the time left down from the newest report,
 *   and hold it at 0, which reads `about 1s left`.
 * - Enough progress. Neither part shows before a report a second after the first, nor on a line
 *   that reports no count, and an update of `total` or `label` alone is no sample.
 * - The edges. A stalled count reads `0/s` and no time left, a count that goes backward restarts the
 *   window, a count at or past `total` keeps the rate and drops the time left, a `total` that grows
 *   lengthens the time left and leaves the rate, and a line without a total shows the rate alone.
 * - The unit and the formats. `unit` names the count in the rate, a slow rate reads per minute or
 *   per hour, and long times left read minutes or hours.
 * - The view's data. A line supplies `estimate`, `rate`, `remaining`, and `unit` whether or not
 *   `estimate` is set, and the default view draws neither part without it.
 * - Ends and plain lines. An end line draws neither part, and off a live region the start and end
 *   lines carry neither.
 * - A narrow row. The rate gives way first, then the time left, and a line still too wide draws as
 *   before. `progress-estimate-pty.test.ts` proves the drawn line on a real terminal.
 */
import { Application, override } from '@loomcli/core';
import type { ActionContext } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

import { progress, progressStyle } from '../src/index.js';
import type { ProgressSettings } from '../src/index.js';
import { progressLine } from '../src/views.js';
import type { ProgressLine } from '../src/views.js';

/** One frame the line drew: the data its view received and the default view's text for it. */
interface Drawn {
  readonly data: ProgressLine;
  readonly text: string;
}

/** What a line's script reads: the action's context and a way to move the clock. */
interface Clock {
  /** Moves the faked clock forward to `ms` milliseconds after the line's opening, firing its timer. */
  readonly at: (ms: number) => void;
}

/** A spinner whose timer never fires within a test's minutes. */
const still = { frames: ['◐'], interval: 3_600_000 };

/**
 * Runs `script` as an action on a mock terminal `columns` wide, the clock at 0 when it starts, or
 * on a piped stderr when `piped`, and answers each frame the line drew with the run's stderr.
 */
async function drawn(
  script: (context: ActionContext<unknown>, clock: Clock) => Promise<void>,
  { columns = 100, piped = false }: { columns?: number; piped?: boolean } = {},
): Promise<{ frames: Drawn[]; stderr: string }> {
  const frames: Drawn[] = [];
  const mock = mockProcess({
    env: { COLORTERM: undefined, FORCE_COLOR: undefined, NO_COLOR: '1', TERM: 'xterm' },
    terminal: { columns, rows: 24, streams: piped ? [] : ['stderr'] },
  });
  const app = new Application('estimate', {
    description: 'Show a progress line with its rate and time left.',
    plugins: [progressStyle({ spinner: still })],
    views: [
      override(progressLine, {
        render: (data, context) => {
          const text = progressLine.render(data, context);
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
        at: (ms) => {
          vi.advanceTimersByTime(ms - Date.now());
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });
  await app.run({ process: mock });
  return { frames, stderr: mock.stderr.text };
}

/** Opens a line with `settings`, makes each report at its time, and ends the line. */
function reporting(
  settings: ProgressSettings,
  reports: readonly (readonly [number, number])[],
): (context: ActionContext<unknown>, clock: Clock) => Promise<void> {
  return async (context, { at }) => {
    const line = progress(context, settings);
    for (const [time, completed] of reports) {
      at(time);
      line.update({ completed });
    }
    await line.end('Done');
  };
}

/** The text of each running frame drawn at a report, in order: every frame after the opening. */
function reportFrames(frames: readonly Drawn[]): string[] {
  return frames
    .filter((frame) => frame.data.state === 'running')
    .slice(1)
    .map((frame) => frame.text);
}

/** The worked sequence of the reference: 1, 10, 40, 70, and 100 of 120. */
const worked = [
  [500, 1],
  [3000, 10],
  [12_000, 40],
  [13_000, 70],
  [14_000, 100],
] as const;

test('the worked sequence draws the rate and time left the reference states, and the rate follows faster work', async () => {
  const { frames } = await drawn(
    reporting({ estimate: true, label: 'Copying files', total: 120 }, worked),
  );
  expect(reportFrames(frames)).toEqual([
    '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 1/120 · 0.5s',
    '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s · 3.6/s · about 31s left',
    '◐ Copying files ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s · 3.3/s · about 24s left',
    '◐ Copying files ▰▰▰▰▰▱▱▱▱▱ 70/120 · 13.0s · 6.0/s · about 9s left',
    '◐ Copying files ▰▰▰▰▰▰▰▰▱▱ 100/120 · 14.0s · 8.1/s · about 3s left',
  ]);
});

/** The settings of the worked sequence's line. */
const copying = { estimate: true, label: 'Copying files', total: 120 } as const;

/** The last running frame drawn at `elapsed` milliseconds. */
function runningAt(frames: readonly Drawn[], elapsed: number): Drawn | undefined {
  return frames.findLast(
    (frame) => frame.data.state === 'running' && frame.data.elapsed === elapsed,
  );
}

test('timer frames between reports count the time left down from the newest report and hold it at 0', async () => {
  const { frames } = await drawn(async (context, { at }) => {
    const line = progress(context, { ...copying, spinner: { frames: ['◐'], interval: 500 } });
    for (const [time, completed] of worked) {
      at(time);
      line.update({ completed });
    }
    at(17_500);
    await line.end('Done');
  });
  expect(runningAt(frames, 12_500)?.text).toBe(
    '◐ Copying files ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.5s · 3.3/s · about 24s left',
  );
  expect(runningAt(frames, 16_000)?.text).toBe(
    '◐ Copying files ▰▰▰▰▰▰▰▰▱▱ 100/120 · 16.0s · 8.1/s · about 1s left',
  );
  expect(runningAt(frames, 17_500)?.text).toBe(
    '◐ Copying files ▰▰▰▰▰▰▰▰▱▱ 100/120 · 17.5s · 8.1/s · about 1s left',
  );
  expect(runningAt(frames, 12_500)?.data.remaining).toBeCloseTo(23_089.74, 1);
  expect(runningAt(frames, 16_000)?.data.remaining).toBeCloseTo(444.44, 1);
  expect(runningAt(frames, 17_000)?.data.remaining).toBe(0);
  expect(runningAt(frames, 17_500)?.data.remaining).toBe(0);
});

test('neither part shows before a report a second after the first, and an update of total or label alone is no sample', async () => {
  const { frames } = await drawn(async (context, { at }) => {
    const line = progress(context, copying);
    at(1500);
    line.update({ label: 'Copying the files' });
    line.update({ total: 130 });
    at(2000);
    line.update({ completed: 1 });
    at(2900);
    line.update({ completed: 4 });
    at(3000);
    line.update({ completed: 5 });
    await line.end('Done');
  });
  expect(reportFrames(frames)).toEqual([
    '◐ Copying the files ▱▱▱▱▱▱▱▱▱▱ 0/120 · 1.5s',
    '◐ Copying the files ▱▱▱▱▱▱▱▱▱▱ 0/130 · 1.5s',
    '◐ Copying the files ▱▱▱▱▱▱▱▱▱▱ 1/130 · 2.0s',
    '◐ Copying the files ▱▱▱▱▱▱▱▱▱▱ 4/130 · 2.9s',
    '◐ Copying the files ▱▱▱▱▱▱▱▱▱▱ 5/130 · 3.0s · 4.0/s · about 32s left',
  ]);
  const before = frames.slice(0, 5).map(({ data }) => [data.rate, data.remaining]);
  expect(before).toEqual(Array.from({ length: 5 }, () => [undefined, undefined]));
});

test('a line that reports no count never shows either part', async () => {
  const { frames } = await drawn(async (context, { at }) => {
    const line = progress(context, { estimate: true, label: 'Building the index' });
    at(5000);
    line.update({ label: 'Building the index again' });
    await line.end('Done');
  });
  expect(reportFrames(frames)).toEqual(['◐ Building the index again · 5.0s']);
  expect(frames.map(({ data }) => data.rate)).toEqual([undefined, undefined, undefined]);
});

test('a count that stalls reads a rate of 0 and no time left', async () => {
  const { frames } = await drawn(
    reporting({ ...copying, unit: 'files' }, [
      [500, 5],
      [2000, 5],
    ]),
  );
  expect(reportFrames(frames)).toEqual([
    '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 5/120 · 0.5s',
    '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 5/120 · 2.0s · 0 files/s',
  ]);
  expect(runningAt(frames, 2000)?.data).toMatchObject({ rate: 0, remaining: undefined });
});

test('a count that goes backward restarts the window, so neither part shows until a second after it', async () => {
  const { frames } = await drawn(
    reporting(copying, [
      [500, 1],
      [3000, 10],
      [3500, 4],
      [4400, 6],
      [4600, 8],
    ]),
  );
  expect(reportFrames(frames)).toEqual([
    '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 1/120 · 0.5s',
    '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s · 3.6/s · about 31s left',
    '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 4/120 · 3.5s',
    '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 6/120 · 4.4s',
    '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 8/120 · 4.6s · 3.6/s · about 31s left',
  ]);
});

test('a count at or past its total keeps the rate and shows no time left', async () => {
  const { frames } = await drawn(
    reporting({ ...copying, total: 10 }, [
      [500, 1],
      [2500, 10],
      [3500, 12],
    ]),
  );
  expect(reportFrames(frames)).toEqual([
    '◐ Copying files ▰▱▱▱▱▱▱▱▱▱ 1/10 · 0.5s',
    '◐ Copying files ▰▰▰▰▰▰▰▰▰▰ 10/10 · 2.5s · 4.5/s',
    '◐ Copying files ▰▰▰▰▰▰▰▰▰▰ 12/10 · 3.5s · 3.6/s',
  ]);
  expect(runningAt(frames, 2500)?.data.remaining).toBeUndefined();
});

test('a total that grows lengthens the time left at the next frame and leaves the rate alone', async () => {
  const { frames } = await drawn(async (context, { at }) => {
    const line = progress(context, copying);
    at(500);
    line.update({ completed: 1 });
    at(3000);
    line.update({ completed: 10 });
    at(3200);
    line.update({ total: 220 });
    await line.end('Done');
  });
  expect(reportFrames(frames).slice(1)).toEqual([
    '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s · 3.6/s · about 31s left',
    '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/220 · 3.2s · 3.6/s · about 59s left',
  ]);
});

test('a line without a total shows its rate alone', async () => {
  const { frames } = await drawn(
    reporting({ estimate: true, label: 'Reading rows' }, [
      [500, 204],
      [3000, 1204],
    ]),
  );
  expect(reportFrames(frames)).toEqual([
    '◐ Reading rows 204 · 0.5s',
    '◐ Reading rows 1204 · 3.0s · 400/s',
  ]);
});

test('the unit names what the rate counts', async () => {
  const { frames } = await drawn(reporting({ ...copying, unit: 'files' }, worked));
  expect(reportFrames(frames)[2]).toBe(
    '◐ Copying files ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s · 3.3 files/s · about 24s left',
  );
});

test('the view data carries the rate and time left without estimate, which the default view does not draw', async () => {
  const { frames } = await drawn(reporting({ label: 'Copying files', total: 120 }, worked));
  expect(reportFrames(frames)[1]).toBe('◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s');
  const data = runningAt(frames, 3000)?.data;
  expect(data).toMatchObject({ estimate: false, rate: 3.6 });
  expect(data?.remaining).toBeCloseTo(30_555.56, 1);
  expect(Object.keys(data ?? {})).toEqual(expect.arrayContaining(['remaining', 'unit']));
});

test('the view data carries the setting, the unit, and no rate or time left before there is enough progress', async () => {
  const { frames } = await drawn(reporting({ ...copying, unit: 'files' }, worked));
  const [opening, first, second] = frames.map(({ data }) => data);
  expect(opening).toMatchObject({ estimate: true, rate: undefined, unit: 'files' });
  expect(first).toMatchObject({ rate: undefined, remaining: undefined });
  expect(second).toMatchObject({ estimate: true, rate: 3.6, unit: 'files' });
});

test('an end line draws neither part, while its data carries the values of its frame', async () => {
  const { frames } = await drawn(async (context, { at }) => {
    const line = progress(context, copying);
    for (const [time, completed] of worked) {
      at(time);
      line.update({ completed });
    }
    await line.end('Copied 100 files');
    const failing = progress(context, copying);
    for (const [time, completed] of worked) {
      at(time + 14_000);
      failing.update({ completed });
    }
    await failing.fail();
  });
  const ends = frames.filter(({ data }) => data.state !== 'running');
  expect(ends.map(({ text }) => text)).toEqual([
    '✔ Copied 100 files · 14.0s',
    '✘ Copying files · 14.0s',
  ]);
  expect(ends[0]?.data.rate).toBeCloseTo(8.18, 2);
});

test('where the line does not draw, its start and end lines carry neither part', async () => {
  const { frames, stderr } = await drawn(reporting({ ...copying, unit: 'files' }, worked), {
    piped: true,
  });
  expect(frames).toEqual([]);
  expect(stderr).toBe('ℹ Copying files\n✔ Done\n');
});

test.each([
  { columns: 65, shown: '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s · 3.6/s · about 31s left' },
  { columns: 64, shown: '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s · about 31s left' },
  { columns: 57, shown: '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s · about 31s left' },
  { columns: 56, shown: '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s' },
  { columns: 39, shown: '◐ Copying files ▱▱▱▱▱▱▱▱▱▱ 10/120 · 3.0s' },
])('on a row $columns columns wide, the line reads "$shown"', async ({ columns, shown }) => {
  const { frames } = await drawn(
    reporting(copying, [
      [500, 1],
      [3000, 10],
    ]),
    { columns },
  );
  expect(reportFrames(frames)[1]).toBe(shown);
});

test('the default view formats rates and times left, and fits 80 columns where the destination has no width', async () => {
  const mock = mockProcess({ env: { NO_COLOR: '1' } });
  const base = {
    bar: { complete: '#', incomplete: '-' },
    completed: undefined,
    elapsed: 0,
    estimate: true,
    frame: '*',
    label: 'Work',
    state: 'running',
    total: undefined,
  } as const;
  const rows: ProgressLine[] = [
    { ...base, rate: 1204.9 },
    { ...base, rate: 10 / 3, unit: 'files' },
    { ...base, rate: 0.25, unit: 'files' },
    { ...base, rate: 1 / 7200 },
    { ...base, rate: 0, unit: 'files' },
    { ...base, rate: 1, remaining: 0 },
    { ...base, rate: 1, remaining: 5000 },
    { ...base, rate: 1, remaining: 59_001 },
    { ...base, rate: 1, remaining: 89_000 },
    { ...base, rate: 1, remaining: 90_000 },
    { ...base, rate: 1, remaining: 180_000 },
    { ...base, rate: 1, remaining: 3_570_000 },
    { ...base, rate: 1, remaining: 7_200_000 },
    { ...base, label: 'x'.repeat(50), rate: 10 / 3, remaining: 24_000 },
    { ...base, estimate: undefined, rate: 1, remaining: 5000 },
    { ...base, remaining: 5000 },
  ];
  await new Application('formats', { description: 'Draw progress data.' })
    .action(async ({ out }) => {
      for (const row of rows) {
        await out.render(row, {
          render: (data, context) => `${progressLine.render(data, context)}\n`,
        });
      }
    })
    .run({ process: mock });
  expect(mock.stdout.text.split('\n').slice(0, -1)).toEqual([
    '* Work · 0.0s · 1204/s',
    '* Work · 0.0s · 3.3 files/s',
    '* Work · 0.0s · 15 files/min',
    '* Work · 0.0s · 0.5/h',
    '* Work · 0.0s · 0 files/s',
    '* Work · 0.0s · 1.0/s · about 1s left',
    '* Work · 0.0s · 1.0/s · about 5s left',
    '* Work · 0.0s · 1.0/s · about 1m left',
    '* Work · 0.0s · 1.0/s · about 1m left',
    '* Work · 0.0s · 1.0/s · about 2m left',
    '* Work · 0.0s · 1.0/s · about 3m left',
    '* Work · 0.0s · 1.0/s · about 1h left',
    '* Work · 0.0s · 1.0/s · about 2h left',
    `* ${'x'.repeat(50)} · 0.0s · about 24s left`,
    '* Work · 0.0s',
    '* Work · 0.0s',
  ]);
});
