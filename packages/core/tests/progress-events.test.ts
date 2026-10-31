import { expect, test } from 'vite-plus/test';
/*
 * Acceptance plan for progress events (docs/core/output.md#progress-events).
 *
 * - Order. Under `app.invoke` with `onProgress`, a fixture action whose region reports three times
 *   and then ends delivers `started`, `updated`, `updated`, and `ended` in order, with the latest
 *   label, `completed`, and `total` on each. Two regions number 1 and 2 by first report. A region
 *   whose first report carries only `completed` delivers `label` `''`, each event is frozen, and
 *   the observer has received the event before `report` returns. A label reported as
 *   `style.highlight('x')` reaches the observer as `x`.
 * - Ends. A region closed by `end('failed')` and by a thrown failure delivers `failed`, one closed
 *   by the action's return delivers `ended`, and one closed by the call's cancellation delivers
 *   `cancelled`. A region that never reported delivers nothing. A region ended with a label
 *   delivers that label, plain, on its end event alone, and one ended with none keeps its last
 *   reported label.
 * - Not logging. A fixture `onLog` hook receives no event for any report.
 */

import { ProgressLedger } from '../src/progress-events.js';
import type { ProgressEvent } from '../src/types.js';
import { invoke as invokeFixture } from './run-fixture.ts';

/** A ledger whose events land in the returned list, with markup stripped by a stand-in. */
function ledger(): { events: ProgressEvent[]; ledger: ProgressLedger } {
  const events: ProgressEvent[] = [];
  return {
    events,
    ledger: new ProgressLedger({
      deliver: (event) => {
        events.push(event);
      },
      plain: (text) => text.replaceAll('*', ''),
    }),
  };
}

test('three reports and an end build started, updated, updated, and ended with the latest values', () => {
  const { events, ledger: run } = ledger();
  const region = run.region();
  region.report({ label: 'Fetching', total: 3 });
  region.report({ completed: 1 });
  region.report({ completed: 2, label: 'Fetching more' });
  region.close('end', 'ended');
  expect(events).toStrictEqual([
    { id: 1, label: 'Fetching', state: 'started', total: 3 },
    { completed: 1, id: 1, label: 'Fetching', state: 'updated', total: 3 },
    { completed: 2, id: 1, label: 'Fetching more', state: 'updated', total: 3 },
    { completed: 2, id: 1, label: 'Fetching more', state: 'ended', total: 3 },
  ]);
});

test("an end label replaces the region's label on its end event alone, read as plain text", () => {
  const { events, ledger: run } = ledger();
  const region = run.region();
  region.report({ completed: 3, label: 'Fetching', total: 3 });
  region.close('end', 'failed', '*Fetch* refused.');
  expect(events).toStrictEqual([
    { completed: 3, id: 1, label: 'Fetching', state: 'started', total: 3 },
    { completed: 3, id: 1, label: 'Fetch refused.', state: 'failed', total: 3 },
  ]);
});

test('regions number from 1 in the order each first reports', () => {
  const { events, ledger: run } = ledger();
  const first = run.region();
  const second = run.region();
  second.report({ label: 'second' });
  first.report({ label: 'first' });
  expect(events.map(({ id, label }) => [id, label])).toEqual([
    [1, 'second'],
    [2, 'first'],
  ]);
});

test("a first report that carries only completed reads label ''", () => {
  const { events, ledger: run } = ledger();
  run.region().report({ completed: 4 });
  expect(events).toStrictEqual([{ completed: 4, id: 1, label: '', state: 'started' }]);
});

test('each event is frozen and its label is plain text', () => {
  const { events, ledger: run } = ledger();
  run.region().report({ label: '*bold*' });
  expect(Object.isFrozen(events[0])).toBe(true);
  expect(events[0]?.label).toBe('bold');
});

test.each([
  ['end', 'ended', 'ended'],
  ['end', 'failed', 'failed'],
  ['completion', 'ended', 'ended'],
  ['failure', 'ended', 'failed'],
  ['cancellation', 'ended', 'cancelled'],
] as const)('a region closed by %s with end state %s builds %s', (closer, state, built) => {
  const { events, ledger: run } = ledger();
  const region = run.region();
  region.report({ label: 'work' });
  region.close(closer, state);
  expect(events.at(-1)?.state).toBe(built);
});

test('a region that never reported builds no event when it closes', () => {
  const { events, ledger: run } = ledger();
  run.region().close('end', 'ended');
  expect(events).toEqual([]);
});

const fixture = new URL('fixtures/progress-events.mjs', import.meta.url);

/** The fixture's JSON report for one scenario of observed invocations by name. */
async function observed(scenario: string): Promise<Record<string, unknown>> {
  const result = await invokeFixture(fixture, [scenario]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test("onProgress receives a region's started, updated, updated, and ended events in order, each before report returns", async () => {
  await expect(observed('order')).resolves.toEqual({
    events: [
      { id: 1, label: 'Fetching', state: 'started', total: 3 },
      { completed: 1, id: 1, label: 'Fetching', state: 'updated', total: 3 },
      { completed: 2, id: 1, label: 'Fetching more', state: 'updated', total: 3 },
      { completed: 2, id: 1, label: 'Fetching more', state: 'ended', total: 3 },
    ],
    frozen: [true, true, true, true],
    notes: { receivedBeforeReturn: 1 },
  });
});

test("onProgress numbers regions by first report, reads label '' before one is given, and reads a styled label plain", async () => {
  const events = [
    Object(await observed('numbering').then((fixtureResult) => fixtureResult.events)),
  ].flat();
  expect(events.filter((event) => event.state === 'started')).toEqual([
    { completed: 4, id: 1, label: '', state: 'started' },
    { id: 2, label: 'x', state: 'started' },
  ]);
});

/** The label and state of each event one observed call received. */
function states(run: unknown): unknown {
  return Object(run).events.map((event: { label: string; state: string }) => [
    event.label,
    event.state,
  ]);
}

test('each way a region closes reaches onProgress as its end state, and a region that never reported delivers nothing', async () => {
  const ends = await observed('ends');
  expect(states(ends.endFailed)).toEqual([
    ['end failed', 'started'],
    ['end failed', 'failed'],
  ]);
  expect(states(ends.thrown)).toEqual([
    ['thrown', 'started'],
    ['thrown', 'failed'],
  ]);
  expect(states(ends.returned)).toEqual([
    ['returned', 'started'],
    ['returned', 'ended'],
  ]);
  expect(ends.cancelled).toEqual({
    events: [
      { id: 1, label: 'cancelled', state: 'started' },
      { id: 1, label: 'cancelled', state: 'cancelled' },
    ],
    status: 'cancelled',
  });
  expect(ends.silent).toEqual({ events: [], status: 'completed' });
});

test('an onLog hook receives no event for any report', async () => {
  await expect(observed('logging')).resolves.toEqual({ events: 3, heard: [] });
});

test("an action's call delivers its events to its own observer alone, and inherits none from its parent", async () => {
  await expect(observed('nested')).resolves.toEqual({
    inner: [
      { id: 1, label: 'inner', state: 'started' },
      { id: 1, label: 'inner', state: 'ended' },
    ],
    outer: [
      { id: 1, label: 'outer', state: 'started' },
      { id: 1, label: 'outer', state: 'ended' },
    ],
  });
});

test('an observer that throws is called no more, the run settles, and invoke rejects with its throw', async () => {
  await expect(observed('throws')).resolves.toEqual({
    calls: 1,
    finished: true,
    rejected: true,
  });
});
