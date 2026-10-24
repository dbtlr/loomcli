/*
 * Acceptance plan for observing log events (docs/core/lifecycle-hooks.md#observing-log-events).
 *
 * The hook is proven when public APIs alone produce these results under Node and Bun:
 *
 * - Order and reach. Two fixture plugins receive each event in installation order, the same frozen
 *   object. Events of an action's `invoke` reach both with the parent run's destination, and the
 *   nested run's captured `messages` hold nothing either wrote to `destination.stderr`. An
 *   `app.invoke` passes `stderr` `null` and the `env` its handle supplied, and a `run({ process: processHandle({ env
 *   }) })` override reaches `destination.env`.
 * - Broken hooks. A hook that throws a `TypeError` on every event is reported once, receives every
 *   later event, the fatal event of its own report included, leaves a second plugin's hook
 *   receiving every event, and makes a run that would exit 0 exit 1; such a hook in a run a caller
 *   cancelled keeps 130. A hook that throws on core's `fatal` event alone is reported once, and its
 *   throw on its own report's event is not.
 * - Types. The negative type checks reject a hook that returns a value.
 */

// Acceptance plan: see packages/core/tests/logging.test.ts.

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/observing-log.mjs', import.meta.url);

/** One line each hook of the fixture printed about an event it received. */
interface Seen {
  destination?: { env: string | null; platform: string; stderr: 'null' | 'stream' };
  message?: string;
  messages?: string;
  marker?: string;
  output?: string;
  plugin?: string;
  same?: boolean;
}

/** What one run printed: the hooks' lines, the host stderr text, and the counters. */
interface Observed {
  calls: number;
  fine: string[];
  printed: Seen[];
  resolved: string | undefined;
  stdout: string;
  written: string;
}

function run(scenario: string, build: 'development' | 'distributed' = 'distributed'): Observed {
  const result = invoke(fixture, [scenario], { env: { FIXTURE_BUILD: build } });
  const line = (name: string) =>
    result.stdout
      .split('\n')
      .find((entry) => entry.startsWith(`${name}:`))
      ?.slice(name.length + 1);
  return {
    calls: Number(line('calls')),
    fine: JSON.parse(line('fine') ?? '[]'),
    printed: JSON.parse(line('printed') ?? '[]'),
    resolved: line('resolved'),
    stdout: result.stdout,
    written: JSON.parse(line('written') ?? '""'),
  };
}

/** The destinations the hooks of one run saw, in the order they were called. */
function destinations(printed: Seen[]) {
  return printed.filter(({ plugin }) => plugin !== undefined).map(({ destination }) => destination);
}

test('two plugins receive each event in installation order, the same frozen object', () => {
  const { printed, written } = run('order');
  expect(printed.map(({ plugin, same }) => [plugin, same])).toEqual([
    ['fixture/first', true],
    ['fixture/second', true],
  ]);
  expect(written).toBe('fixture/first:one\nfixture/second:one\n');
});

test('a run({ process }) handle reaches the destination env, platform, and stderr', () => {
  expect(destinations(run('order').printed)).toEqual([
    { env: 'run', platform: 'probe-os', stderr: 'stream' },
    { env: 'run', platform: 'probe-os', stderr: 'stream' },
  ]);
});

test("an action's invoke delivers to the parent's destination and captures none of it", () => {
  const { printed, written } = run('invoke');
  expect(written).toBe('fixture/first:inner\nfixture/second:inner\n');
  expect(destinations(printed)).toEqual([
    { env: 'run', platform: 'probe-os', stderr: 'stream' },
    { env: 'run', platform: 'probe-os', stderr: 'stream' },
  ]);
  expect(printed.at(-1)).toEqual({ messages: '', output: '' });
});

test('app.invoke passes a null stderr and the env its host replaced', () => {
  const { printed, written } = run('app-invoke');
  const after = printed.slice(printed.findIndex(({ marker }) => marker === 'invoke') + 1);
  expect(destinations(after)).toEqual([
    { env: 'invoked', platform: 'named-os', stderr: 'null' },
    { env: 'invoked', platform: 'named-os', stderr: 'null' },
  ]);
  expect(after.at(-1)).toEqual({ messages: '', output: '' });
  expect(written).toBe('fixture/first:root\nfixture/second:root\n');
});

/** The opening of the Developer Diagnostic a hook's first throw reports. */
const hookThrow = /^-- UNHANDLED EXCEPTION -+ @loomcli\/core\/foreign-throw\n\nCannot observe\.\n/u;

test('a hook that throws is still called for every later event, and its first throw is one defect that turns exit 0 into 1', () => {
  const developed = run('throws-on-event', 'development');
  // The hook receives both events and the fatal event its own report logs.
  expect(developed.calls).toBe(3);
  expect(developed.fine).toEqual(['one', 'two', 'Cannot observe.']);
  expect(developed.resolved).toBe('1');
  expect(developed.written).toMatch(hookThrow);
  expect(developed.written.match(/^-- /gmu)).toHaveLength(1);
  const distributed = run('throws-on-event', 'distributed');
  expect(distributed.calls).toBe(3);
  expect(distributed.resolved).toBe('1');
  expect(distributed.written).toBe('probe: Something went wrong.\n');
});

test('a stdout that fails and a hook that throws write two diagnostics with one blank line between', () => {
  const result = run('stdout-and-hook-broken', 'development');
  expect(result.resolved).toBe('1');
  expect(result.written).toMatch(hookThrow);
  expect(result.written).toMatch(
    /\n\n-- BROKEN DESTINATION -+ @loomcli\/core\/broken-destination\n/u,
  );
});

test('a throwing hook in a run a caller cancelled keeps 130 and still writes the report', () => {
  const result = run('cancelled-broken', 'development');
  expect(result.resolved).toBe('130');
  expect(result.fine).toEqual(['one', 'two', 'Cannot observe.']);
  expect(result.written).toMatch(hookThrow);
});

test("a hook that throws on the fatal event is reported once, and its throw on its own report's event is not", () => {
  const developed = run('throws-on-fatal', 'development');
  expect(developed.calls).toBe(2);
  expect(developed.fine).toEqual(['The probe failed.', 'Cannot observe.']);
  expect(developed.written.match(/^-- UNHANDLED EXCEPTION/gmu)).toHaveLength(2);
  expect(developed.written).toContain('\n\nCannot observe.\n');
  const distributed = run('throws-on-fatal', 'distributed');
  expect(distributed.calls).toBe(2);
  expect(distributed.written).toBe('probe: Something went wrong.\n');
});
