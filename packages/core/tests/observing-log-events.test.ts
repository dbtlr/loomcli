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

test('a run({ host }) override reaches the destination env, platform, and stderr', () => {
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

const broken = [
  ['throws-on-event', 'Cannot observe.'],
  ['returns-true', 'The hook returned a value.'],
  ['returns-promise', 'The hook returned a promise.'],
] as const;

test.each(broken)(
  'a hook that %s is reported once, receives no later event, and turns exit 0 into 1',
  (scenario, reason) => {
    const developed = run(scenario, 'development');
    expect(developed.calls).toBe(1);
    expect(developed.fine).toEqual(['one', 'two']);
    expect(developed.resolved).toBe('1');
    expect(developed.written).toMatch(
      /^-- BROKEN LOG HOOK -+ @loomcli\/core\/broken-log-hook\n\nPlugin "fixture\/broken" failed in onLog: /u,
    );
    expect(developed.written).toContain(`Plugin "fixture/broken" failed in onLog: ${reason}\n`);
    expect(developed.written.match(/failed in onLog/gu)).toHaveLength(1);
    const distributed = run(scenario, 'distributed');
    expect(distributed.calls).toBe(1);
    expect(distributed.fine).toEqual(['one', 'two']);
    expect(distributed.resolved).toBe('1');
    expect(distributed.written).toBe('probe: Something went wrong.\n');
  },
);

test('a broken hook in a run a caller cancelled keeps 130 and still writes the report', () => {
  const result = run('cancelled-broken', 'development');
  expect(result.resolved).toBe('130');
  expect(result.calls).toBe(1);
  expect(result.fine).toEqual(['one', 'two']);
  expect(result.written).toContain('Plugin "fixture/broken" failed in onLog: Cannot observe.\n');
});

test('a hook that throws on the fatal event is reported once and the run logs no further event', () => {
  const developed = run('throws-on-fatal', 'development');
  expect(developed.calls).toBe(1);
  expect(developed.fine).toEqual(['The probe failed.']);
  expect(developed.written.match(/failed in onLog/gu)).toHaveLength(1);
  expect(developed.written).toContain('@loomcli/core/foreign-throw');
  const distributed = run('throws-on-fatal', 'distributed');
  expect(distributed.calls).toBe(1);
  expect(distributed.written).toBe('probe: Something went wrong.\n');
});

test('plugin() rejects an onLog that is not a function', () => {
  expect(run('not-function').stdout).toContain(
    'thrown:1: Plugin "@acme/stacks" declares onLog that is not a function. Supply a function of the log event and its destination.\n',
  );
});
