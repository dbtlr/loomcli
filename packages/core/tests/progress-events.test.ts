import { expect, test } from 'vite-plus/test';

import { ProgressLedger } from '../src/progress-events.js';
import type { ProgressEvent } from '../src/types.js';

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
