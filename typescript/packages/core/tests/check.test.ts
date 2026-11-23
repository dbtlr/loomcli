/*
 * Acceptance plan for check() (docs/core/graph-inspection.md#checking-the-declarations).
 *
 * `check()` is proven when public APIs and process runs alone produce these results under Node and
 * Bun:
 *
 * - Clean. A fixture declaring options with validators and a valid default returns an
 *   empty list.
 * - Every fault. A fixture with two inputs whose converters throw and an `onGraphBuilt` hook that
 *   rejects the graph returns three faults, in that order, under
 *   `@loomcli/core/schema-converter-failed` twice and the hook's rule. `run()` from source reports
 *   the first alone, and `inspect()` throws it.
 * - A build fault. A root with neither children nor an action returns one fault, the one
 *   `inspect()` throws, and no hook runs.
 * - Whatever the build. The fixture bundled by `loom build`, which reads `distributed`, returns the
 *   same three faults.
 * - Not the defaults. A fixture whose declared default its validator rejects returns an empty list,
 *   and `run()` reports the default.
 * - A broken hook. An `onGraphBuilt` hook that throws a `TypeError` adds the
 *   `@loomcli/core/broken-graph-hook` fault, and `check()` returns.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The declarations each case checks, runs, or inspects. */
const fixture = new URL('fixtures/check.mjs', import.meta.url);

/** The script that bundles a fixture with `Bun.build` and a define, as `loom build` does. */
const bundler = fileURLToPath(new URL('fixtures/release/bundle.mjs', import.meta.url));

/** The runtime selected for this whole suite by CI. */
const suiteRuntime = process.env.LOOM_TEST_RUNTIME ?? 'node';

const root = mkdtempSync(join(tmpdir(), 'loom-check-'));

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

/** What the fixture printed for one scenario and mode under one runtime, parsed. */
function report(runtime: string, scenario: string, mode = 'check') {
  const result = invoke(fixture, [scenario, mode], { runtime });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

/** One fault as the fixture prints it. */
function fault(rule: string, sentence: string, banner: string) {
  return {
    banner: `${`-- ${banner} `.padEnd(80 - rule.length - 1, '-')} ${rule}`,
    declaration: true,
    rule,
    sentence,
  };
}

const converterFaults = [
  fault(
    '@loomcli/core/schema-converter-failed',
    'Option "level" validator\'s JSON Schema converter failed for target "draft-2020-12": No level schema.',
    'SCHEMA CONVERTER FAILED',
  ),
  fault(
    '@loomcli/core/schema-converter-failed',
    'Option "limit" validator\'s JSON Schema converter failed for target "draft-2020-12": No limit schema.',
    'SCHEMA CONVERTER FAILED',
  ),
];

/** The three faults the faulty declaration holds, in the order a run meets them. */
const everyFault = [
  ...converterFaults,
  fault('@fixture/judge/shared-name', 'The graph shares a name.', 'SHARED NAME'),
];

test('check() returns an empty list for a declaration with nothing wrong in it, under the suite runtime', () => {
  expect(report(suiteRuntime, 'clean').faults).toEqual([]);
});

test('check() returns every fault a development run meets before routing, in order, under the suite runtime', () => {
  const runtime = suiteRuntime;
  expect(report(runtime, 'faults')).toEqual({
    faults: everyFault,
    // Both hooks ran on the one frozen graph, where each failed converter reads null.
    hooks: { calls: 2, frozen: true, same: true, schemas: [null, null] },
    list: true,
  });
});

test('run() from source reports the first fault alone and inspect() throws it, under the suite runtime', () => {
  const runtime = suiteRuntime;
  const ran = invoke(fixture, ['faults', 'run'], { runtime });
  expect(ran.status).toBe(1);
  expect(ran.stdout).toBe('');
  expect(ran.stderr.match(/^-- /gmu)).toHaveLength(1);
  expect(ran.stderr).toContain(`\n\n${converterFaults[0]?.sentence}\n\n`);
  expect(report(runtime, 'faults', 'inspect')).toEqual({
    rule: converterFaults[0]?.rule,
    sentence: converterFaults[0]?.sentence,
  });
});

test('a build rule fault is the one fault check() returns, the one inspect() throws, and no hook runs, under the suite runtime', () => {
  const runtime = suiteRuntime;
  const thrown = report(runtime, 'build-fault', 'inspect');
  expect(report(runtime, 'build-fault')).toEqual({
    faults: [
      fault(
        '@loomcli/core/command-without-action',
        'The root Command has no action.',
        'NOTHING TO RUN',
      ),
    ],
    hooks: { calls: 0, frozen: null, same: true, schemas: null },
    list: true,
  });
  expect(thrown).toEqual({
    rule: '@loomcli/core/command-without-action',
    sentence: 'The root Command has no action.',
  });
});

/** The bundles of check.mjs built so far, by name, so each is built once whichever test needs it first. */
const bundles = new Map<string, string>();

/** The directory of check.mjs bundled under the baked facts, built on first use. */
function bundled(name: string, facts: string) {
  const known = bundles.get(name);
  if (known !== undefined) {
    return known;
  }
  const outdir = join(root, name);
  const built = spawnSync('bun', [bundler, 'check.mjs', outdir, facts], { encoding: 'utf8' });
  expect(built.stderr).toBe('');
  expect(built.status).toBe(0);
  bundles.set(name, outdir);
  return outdir;
}

const distributedFacts = JSON.stringify({ build: 'distributed' });

test.each([
  ['distributed', distributedFacts],
  ['malformed', '[]'],
])(
  'check() returns the same faults from a bundle whose baked facts read %s, which it never reads',
  (name, facts) => {
    const outdir = bundled(name, facts);
    {
      const runtime = suiteRuntime;
      const result = spawnSync(runtime, [join(outdir, 'check.js'), 'faults'], { encoding: 'utf8' });
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout).faults).toEqual(everyFault);
    }
  },
);

test('check() leaves out a declared default its validator rejects, which run() reports, under the suite runtime', () => {
  const runtime = suiteRuntime;
  expect(report(runtime, 'defaults').faults).toEqual([]);
  const ran = invoke(fixture, ['defaults', 'run'], { runtime });
  expect(ran.status).toBe(1);
  expect(ran.stderr).toMatch(/^-- DEFAULT REJECTED -+ @loomcli\/core\/invalid-default\n/u);
});

test('a hook that throws a TypeError adds the broken-graph-hook fault, and check() returns, under the suite runtime', () => {
  const runtime = suiteRuntime;
  expect(report(runtime, 'broken-hook').faults).toEqual([
    fault(
      '@loomcli/core/broken-graph-hook',
      'Plugin "@fixture/break" failed in onGraphBuilt: The hook broke.',
      'BROKEN GRAPH HOOK',
    ),
  ]);
});
