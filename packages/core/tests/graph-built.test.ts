/*
 * Acceptance plan for judging the built graph (docs/core/lifecycle-hooks.md#judging-the-built-graph).
 *
 * The hook is proven when public APIs alone produce these results under Node and Bun:
 *
 * - Order and reach. A fixture hook records each call: it runs once per `run()`, `inspect()`, and
 *   `app.invoke()`, after every `onCommandAttach` and with the Commands and options those hooks
 *   added, in installation order across two plugins, and never for an action's `invoke`.
 * - Rejection. A hook that throws a `DeclarationError` fails `run()` with exit 1, its Developer
 *   Diagnostic from source and the generic defect message from a bundle, makes `inspect()` throw
 *   it, runs no `onFailure` hook, and stops later hooks.
 * - Broken hooks. A hook that throws a `TypeError` reports `@loomcli/core/broken-graph-hook` with
 *   exit 1, and the fault's `cause` is the `TypeError`.
 * - Frozen. A hook that writes to the graph throws in strict mode, which reports as a foreign
 *   throw, and the graph the action reads is unchanged.
 * - Types. The negative type checks reject a hook that returns a value.
 */

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/graph-built.mjs', import.meta.url);

/** One run of a scenario's captured outcome as the fixture reports it. */
interface Ran {
  exitCode: number;
  stderr: string;
  stdout: string;
}

/** The fixture's JSON report for one scenario, under the build it names. */
function report(scenario: string, build = 'distributed'): string {
  const result = invoke(fixture, [scenario, build]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

/** The rejection scenario's report: the hooks that ran, what inspect() threw, and the run. */
interface Rejected {
  afterRun: string[];
  inspected: string;
  ran: Ran;
}

test('every hook runs once per run(), inspect(), and app.invoke(), in installation order, never for an action invoke', () => {
  expect(JSON.parse(report('order'))).toEqual({
    calls: [
      {
        commands: ['', 'doctor', 'count', 'caller'],
        identity: '@fixture/first',
        options: ['format'],
      },
      {
        commands: ['', 'doctor', 'count', 'caller'],
        identity: '@fixture/second',
        options: ['format'],
      },
    ],
    marks: [
      { calls: 2, label: 'run' },
      { calls: 4, label: 'inspect' },
      { calls: 6, label: 'app.invoke' },
      { calls: 8, label: 'app.invoke with an action invoke' },
    ],
    sameAsAction: true,
  });
});

test("a hook's DeclarationError fails run() with exit 1, stops later hooks, and runs no onFailure hook", () => {
  const distributed: Rejected = JSON.parse(report('reject'));
  expect(distributed.ran).toEqual({
    exitCode: 1,
    stderr: 'probe: Something went wrong.\n',
    stdout: '',
  });
  expect(distributed.afterRun).toEqual(['judge']);
  expect(distributed.inspected).toContain('Commands "a" and "b" share one description.');
});

test("a hook's DeclarationError prints as its own Developer Diagnostic in a development build", () => {
  const development: Rejected = JSON.parse(report('reject', 'development'));
  expect(development.ran.exitCode).toBe(1);
  expect(development.ran.stderr).toMatch(
    /^-- TWO COMMANDS SHARE ONE DESCRIPTION -+ @fixture\/judge\/shared-name\n\nCommands "a" and "b" share one description\.\n/u,
  );
});

test('a hook that throws reports broken-graph-hook with exit 1', () => {
  const distributed: Ran = JSON.parse(report('broken'));
  expect(distributed).toEqual({
    exitCode: 1,
    stderr: 'probe: Something went wrong.\n',
    stdout: '',
  });
  const development: Ran = JSON.parse(report('broken', 'development'));
  expect(development.exitCode).toBe(1);
  expect(development.stderr).toMatch(
    /^-- BROKEN GRAPH HOOK -+ @loomcli\/core\/broken-graph-hook\n/u,
  );
});

test("a broken hook's fault keeps the value the hook threw as its cause", () => {
  expect(JSON.parse(report('cause'))).toEqual({ cause: true });
});

test('the graph is frozen: a write throws, a caught write leaves the graph unchanged, and an uncaught one is a broken hook', () => {
  const frozen: { quiet: Ran; seen: string[]; unguarded: Ran } = JSON.parse(
    report('frozen', 'development'),
  );
  expect(frozen.seen).toEqual(['threw']);
  expect(frozen.quiet).toEqual({ exitCode: 0, stderr: '', stdout: '1\n' });
  expect(frozen.unguarded.exitCode).toBe(1);
  expect(frozen.unguarded.stderr).toContain(' @loomcli/core/broken-graph-hook\n');
});
