import { describe, expect, it, test } from 'vite-plus/test';

import { invoke, start } from '../../../scripts/test-process.js';
import { rowsPerCheck, startPacing, turnDue, turnInterval } from '../src/output/sequence.js';

const fixture = new URL('fixtures/sequence-turns.mjs', import.meta.url);

/**
 * Milliseconds of busy work per row that make every check point find the interval passed, so the
 * rows a turn lands on follow from the constants rather than from the host's speed.
 */
const dueWork = String((turnInterval / rowsPerCheck) * 1.25);

/** The counts one incomplete-result line reports. */
function stoppedCounts(stderr: string): { rows: number; written: number } {
  const counts = /stopped after (?<rows>\d+) rows, (?<written>\d+) written\./u.exec(stderr);
  expect(counts).not.toBeNull();
  return { rows: Number(counts?.groups?.rows), written: Number(counts?.groups?.written) };
}

/** A clock the test moves by hand, counting how often the pacing reads it. */
function handClock(): { clock: () => number; now: number; reads: number } {
  const state = {
    clock: () => {
      state.reads += 1;
      return state.now;
    },
    now: 0,
    reads: 0,
  };
  return state;
}

/** The rows from `from` to `to`, inclusive, that the pacing turns on. */
function turnsOver(pacing: ReturnType<typeof startPacing>, from: number, to: number): number[] {
  const turned: number[] = [];
  for (let yielded = from; yielded <= to; yielded += 1) {
    if (turnDue(pacing, yielded)) {
      turned.push(yielded);
    }
  }
  return turned;
}

describe('the turn a sequence takes', () => {
  it('reads the clock once at the start and then once per check point', () => {
    const hand = handClock();
    const pacing = startPacing(hand.clock);
    expect(hand.reads).toBe(1);
    expect(turnsOver(pacing, 1, rowsPerCheck - 1)).toEqual([]);
    expect(hand.reads).toBe(1);
    expect(turnsOver(pacing, rowsPerCheck, rowsPerCheck * 3 - 1)).toEqual([]);
    expect(hand.reads).toBe(3);
  });

  it('takes no turn before the interval has passed since the start', () => {
    const hand = handClock();
    const pacing = startPacing(hand.clock);
    hand.now = turnInterval - 1;
    expect(turnsOver(pacing, 1, rowsPerCheck * 4)).toEqual([]);
  });

  it('takes one turn at the first check point after the interval, and counts the next from it', () => {
    const hand = handClock();
    hand.now = 1000;
    const pacing = startPacing(hand.clock);
    expect(turnsOver(pacing, 1, rowsPerCheck)).toEqual([]);
    hand.now = 1000 + turnInterval;
    expect(turnsOver(pacing, rowsPerCheck + 1, rowsPerCheck * 3)).toEqual([rowsPerCheck * 2]);
    hand.now = 1000 + turnInterval * 2 - 1;
    expect(turnsOver(pacing, rowsPerCheck * 3 + 1, rowsPerCheck * 5)).toEqual([]);
    hand.now = 1000 + turnInterval * 2;
    expect(turnsOver(pacing, rowsPerCheck * 5 + 1, rowsPerCheck * 6)).toEqual([rowsPerCheck * 6]);
  });
});

describe.each(['row', 'whole'])('%s sequences', (shape) => {
  it.each([
    [0, []],
    [rowsPerCheck - 1, []],
    [
      rowsPerCheck * 2 + rowsPerCheck / 2,
      [rowsPerCheck, rowsPerCheck, rowsPerCheck * 2, rowsPerCheck * 2],
    ],
  ])(
    `${shape} sequences give the event loop two immediates at each due check point (%i rows)`,
    (count, turns) => {
      expect(invoke(fixture, [shape, String(count), dueWork])).toEqual({
        status: 0,
        stderr: '',
        stdout: `${JSON.stringify(turns)}\n`,
      });
    },
  );

  it(`${shape} sequences honour SIGINT even when the source only yields through microtasks`, async () => {
    const running = start(fixture, [shape, 'infinite']);
    try {
      // Whole views write no stdout until collection ends, so the source announces on stderr.
      await (shape === 'row'
        ? running.announced('row')
        : new Promise<void>((resolve) => {
            running.child.stderr.once('data', () => resolve());
          }));
      running.child.kill('SIGINT');
      const result = await running.exit;
      expect({ signal: result.signal, status: result.status }).toEqual({
        signal: 'SIGINT',
        status: null,
      });
      expect(result.stdout).toBe(shape === 'row' ? 'row\n' : '');
      const { rows, written } = stoppedCounts(result.stderr);
      expect(rows).toBeGreaterThan(0);
      expect(rows % rowsPerCheck).toBe(0);
      expect(written).toBe(shape === 'row' ? rows - 1 : 0);
      expect(result.stderr).toBe(
        `${shape === 'whole' ? 'ready\n' : ''}Output is incomplete: the root Command stopped after ${rows} rows, ${written} written.\n`,
      );
    } finally {
      running.child.kill('SIGKILL');
    }
  }, 15_000);
});

test('a sequence resumed from I/O stops at the first due check point after a SIGINT', async () => {
  const running = start(fixture, ['io', 'infinite', dueWork]);
  try {
    const result = await running.exit;
    expect({ signal: result.signal, status: result.status }).toEqual({
      signal: 'SIGINT',
      status: null,
    });
    expect(result.stderr).toBe(
      `Output is incomplete: the root Command stopped after ${rowsPerCheck} rows, ${rowsPerCheck - 1} written.\n`,
    );
  } finally {
    running.child.kill('SIGKILL');
  }
}, 15_000);

test('a source whose rows are slow stops at the first check point after a SIGINT', async () => {
  // Each row takes 2 ms of work that never yields, and the source raises SIGINT mid-interval.
  // The stop lands within one check interval's rows of the signal.
  const rowWork = 2;
  const signalRow = Math.floor(rowsPerCheck * 1.5);
  expect(rowsPerCheck * rowWork).toBeGreaterThanOrEqual(turnInterval);
  const running = start(fixture, ['slow', 'infinite', String(rowWork), String(signalRow)]);
  try {
    const result = await running.exit;
    expect({ signal: result.signal, status: result.status }).toEqual({
      signal: 'SIGINT',
      status: null,
    });
    const { rows, written } = stoppedCounts(result.stderr);
    expect(rows).toBeGreaterThanOrEqual(signalRow);
    expect(rows - signalRow).toBeLessThanOrEqual(rowsPerCheck);
    expect(written).toBe(rows - 1);
  } finally {
    running.child.kill('SIGKILL');
  }
}, 15_000);
