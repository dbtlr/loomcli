/*
 * Acceptance plan for check() (docs/core/graph-inspection.md#checking-the-declarations).
 *
 * `check()` is proven when public APIs and process runs alone produce these results under Node and
 * Bun:
 *
 * - Clean. jsonkit and textstat each return an empty list.
 * - Every fault. A fixture with two inputs whose converters throw and an `onGraphBuilt` hook that
 *   rejects the graph returns three faults, in that order, under
 *   `@loomcli/core/schema-converter-failed` twice and the hook's rule. `run()` from source reports
 *   the first alone, and `inspect()` throws it.
 * - A build fault. A root with neither children nor an action returns one fault, the one
 *   `inspect()` throws, and no hook runs.
 * - Whatever the build. The fixture bundled by `loom build`, which reads `distributed`, returns the
 *   same three faults.
 * - The post-install command. From that bundle, `check()` returns
 *   `@loomcli/core/post-install-unrouted` for words that route to no Command, and `inspect()` runs
 *   no such check.
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

/** The runtimes every case runs under. */
const runtimes = ['node', 'bun'] as const;

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

test.each(runtimes)(
  'check() returns every fault a development run meets before routing, in order, under %s',
  (runtime) => {
    expect(report(runtime, 'faults')).toEqual({
      faults: everyFault,
      // Both hooks ran on the one frozen graph, where each failed converter reads null.
      hooks: { calls: 2, frozen: true, same: true, schemas: [null, null] },
      list: true,
    });
  },
);

test.each(runtimes)(
  'run() from source reports the first fault alone and inspect() throws it, under %s',
  (runtime) => {
    const ran = invoke(fixture, ['faults', 'run'], { runtime });
    expect(ran.status).toBe(1);
    expect(ran.stdout).toBe('');
    expect(ran.stderr.match(/^-- /gmu)).toHaveLength(1);
    expect(ran.stderr).toContain(`\n\n${converterFaults[0]?.sentence}\n\n`);
    expect(report(runtime, 'faults', 'inspect')).toEqual({
      rule: converterFaults[0]?.rule,
      sentence: converterFaults[0]?.sentence,
    });
  },
);

test.each(runtimes)(
  'a build rule fault is the one fault check() returns, the one inspect() throws, and no hook runs, under %s',
  (runtime) => {
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
  },
);

test.each([
  ['distributed', JSON.stringify({ build: 'distributed' })],
  ['malformed', '[]'],
])(
  'check() returns the same faults from a bundle whose baked facts read %s, which it never reads',
  (_name, facts) => {
    const outdir = join(root, _name);
    const built = spawnSync('bun', [bundler, 'check.mjs', outdir, facts], { encoding: 'utf8' });
    expect(built.stderr).toBe('');
    expect(built.status).toBe(0);
    for (const runtime of runtimes) {
      const result = spawnSync(runtime, [join(outdir, 'check.js'), 'faults'], { encoding: 'utf8' });
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout).faults).toEqual(everyFault);
    }
  },
);

test('from a bundle whose baked facts read distributed, check() reports an unrouted post-install command and inspect() does not', () => {
  const outdir = join(root, 'post-install');
  const built = spawnSync(
    'bun',
    [bundler, 'check.mjs', outdir, JSON.stringify({ build: 'distributed' })],
    {
      encoding: 'utf8',
    },
  );
  expect(built.stderr).toBe('');
  expect(built.status).toBe(0);
  for (const runtime of runtimes) {
    const bundle = join(outdir, 'check.js');
    const checked = spawnSync(runtime, [bundle, 'post-install'], { encoding: 'utf8' });
    expect(checked.stderr).toBe('');
    expect(JSON.parse(checked.stdout).faults).toEqual([
      fault(
        '@loomcli/core/post-install-unrouted',
        'The post-install command "setup" routes to no Command with an action.',
        'POST-INSTALL COMMAND UNROUTED',
      ),
    ]);
    const inspected = spawnSync(runtime, [bundle, 'post-install', 'inspect'], { encoding: 'utf8' });
    expect(inspected.stdout).toBe('inspected\n');
  }
});

test.each(runtimes)(
  'check() leaves out a declared default its validator rejects, which run() reports, under %s',
  (runtime) => {
    expect(report(runtime, 'defaults').faults).toEqual([]);
    const ran = invoke(fixture, ['defaults', 'run'], { runtime });
    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(/^-- DEFAULT REJECTED -+ @loomcli\/core\/invalid-default\n/u);
  },
);

test.each(runtimes)(
  'a hook that throws a TypeError adds the broken-graph-hook fault, and check() returns, under %s',
  (runtime) => {
    expect(report(runtime, 'broken-hook').faults).toEqual([
      fault(
        '@loomcli/core/broken-graph-hook',
        'Plugin "@fixture/break" failed in onGraphBuilt: The hook broke.',
        'BROKEN GRAPH HOOK',
      ),
    ]);
  },
);
