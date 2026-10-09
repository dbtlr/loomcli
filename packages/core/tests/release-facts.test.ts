import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The probe each case runs, from source or from a bundle that bakes release facts into it. */
const fixture = new URL('fixtures/release/main.mjs', import.meta.url);

/** The script that bundles a fixture with `Bun.build` and a define, as `loom build` does. */
const bundler = fileURLToPath(new URL('fixtures/release/bundle.mjs', import.meta.url));

/** How long one bundle or one run may take before the test fails. */
const timeout = 60_000;

/** The runtimes every bundle runs under. */
const runtimes = ['node', 'bun'] as const;

const root = mkdtempSync(join(tmpdir(), 'loom-release-'));

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

/** Each bundle built so far, by the facts it bakes. */
const bundles = new Map<string, string>();

/** The bundle of the probe that bakes `facts`, built once per test file. */
function bundled(facts: string): string {
  const known = bundles.get(facts);
  if (known !== undefined) {
    return known;
  }
  const outdir = join(root, String(bundles.size));
  const result = spawnSync('bun', [bundler, 'release/main.mjs', outdir, facts], {
    encoding: 'utf8',
    timeout,
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const main = join(outdir, 'main.js');
  bundles.set(facts, main);
  return main;
}

/** One run of a built artifact: its exit status and what it wrote. */
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/** One scenario of the bundle that bakes `facts`, under one runtime. */
function fromBundle(facts: string, runtime: string, scenario: string) {
  return run(runtime, [bundled(facts), scenario]);
}

/** One scenario run from source, which only Bun runs for an application's TypeScript. */
function fromSource(scenario: string) {
  return invoke(fixture, [scenario], { runtime: 'bun' });
}

/** The first line a printed JSON scenario wrote, parsed. */
function printed(result: { stdout: string }): unknown {
  return JSON.parse(result.stdout);
}

const generic = { status: 1, stderr: 'probe: Something went wrong.\n', stdout: '' };

const foreignThrow =
  /^-- UNHANDLED EXCEPTION -+ @loomcli\/core\/foreign-throw\n\nThe probe failed\.\n/u;

const distributed = JSON.stringify({ build: 'distributed' });

test('a source run reads { build: "source" }, frozen, and a defect writes its Developer Diagnostic', () => {
  expect(printed(fromSource('facts'))).toEqual({ facts: { build: 'source' }, frozen: true });
  const failed = fromSource('throw');
  expect(failed.status).toBe(1);
  expect(failed.stderr).toMatch(foreignThrow);
  expect(failed.stderr).toContain('TypeError: The probe failed.\n');
});

test.each(runtimes)(
  'a bundle that bakes a distributed build reads it with no release group and writes the generic message under %s',
  (runtime) => {
    expect(printed(fromBundle(distributed, runtime, 'facts'))).toEqual({
      facts: { build: 'distributed' },
      frozen: true,
    });
    expect(fromBundle(distributed, runtime, 'throw')).toEqual(generic);
  },
);

test('a bundle that bakes a source build reads it as the source does', () => {
  expect(printed(fromBundle(JSON.stringify({ build: 'source' }), 'node', 'facts'))).toEqual({
    facts: { build: 'source' },
    frozen: true,
  });
});

test.each(runtimes)(
  'a bundle that bakes a development build reads it and writes the Developer Diagnostic under %s',
  (runtime) => {
    const facts = JSON.stringify({ build: 'development' });
    expect(printed(fromBundle(facts, runtime, 'facts'))).toEqual({
      facts: { build: 'development' },
      frozen: true,
    });
    const failed = fromBundle(facts, runtime, 'throw');
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(foreignThrow);
  },
);

test.each([
  ['1.1.0-next.3', 'next'],
  ['1.0.0-beta.1', 'beta'],
  ['2.0.0', 'stable'],
  ['2.0.0+build.5', 'stable'],
])(
  'a bundle that bakes release %s reads lane %s, which core derives, with no asset',
  (version, lane) => {
    const facts = JSON.stringify({
      build: 'distributed',
      release: { repository: 'acme/probe', version },
    });
    for (const runtime of runtimes) {
      expect(printed(fromBundle(facts, runtime, 'facts'))).toEqual({
        facts: { build: 'distributed', release: { lane, repository: 'acme/probe', version } },
        frozen: true,
      });
    }
  },
);

test('a baked member core does not know reads as the known members alone', () => {
  const facts = JSON.stringify({
    build: 'distributed',
    channel: 'npm',
    release: { repository: 'acme/probe', target: 'linux', version: '1.0.0' },
  });
  for (const runtime of runtimes) {
    expect(printed(fromBundle(facts, runtime, 'facts'))).toEqual({
      facts: {
        build: 'distributed',
        release: { lane: 'stable', repository: 'acme/probe', version: '1.0.0' },
      },
      frozen: true,
    });
  }
});

/** The banner every malformed value's diagnostic opens with. */
const invalidBanner =
  '-- INVALID RELEASE FACTS ------------------- @loomcli/core/invalid-release-facts\n\n';

/** The correction every malformed value's diagnostic carries. */
const rebuild = 'Rebuild with loom build, or compose the define from loom build --define.';

test.each([
  ['{"build":"staging"}', 'hold build "staging"'],
  ['[]', 'are not an object'],
  [
    '{"build":"distributed","release":{"version":"one","repository":"acme/probe"}}',
    'hold release version "one"',
  ],
])(
  'a bundle that bakes %s fails every door with invalid-release-facts, and an override replaces it',
  (facts, found) => {
    const sentence = `The release facts baked into __LOOM_RELEASE__ ${found}.`;
    for (const runtime of runtimes) {
      const failed = fromBundle(facts, runtime, 'facts');
      // The run reports before the graph builds, so no action prints.
      expect(failed.status).toBe(1);
      expect(failed.stdout).toBe('');
      expect(failed.stderr.startsWith(`${invalidBanner}${sentence}\n\n`)).toBe(true);
      expect(failed.stderr.endsWith(`\n\n${rebuild}\n`)).toBe(true);
      expect(printed(fromBundle(facts, runtime, 'invoke'))).toMatchObject({
        exitCode: 1,
        form: { code: 'internal', exitCode: 1, hints: [], message: sentence },
        output: '',
        rule: '@loomcli/core/invalid-release-facts',
        status: 'failed',
      });
      expect(printed(fromBundle(facts, runtime, 'inspect'))).toEqual({
        rule: '@loomcli/core/invalid-release-facts',
        sentence,
        thrown: 'InternalError',
      });
      expect(fromBundle(facts, runtime, 'override')).toEqual({
        status: 0,
        stderr: '',
        stdout: `${JSON.stringify({ facts: { build: 'distributed' }, frozen: false })}\n`,
      });
    }
  },
);

test.each([
  ['{}', 'hold no build'],
  ['{"build":5}', 'hold build 5'],
  ['{"build":"distributed","release":"1.0.0"}', 'hold a release that is not an object'],
  [
    '{"build":"distributed","release":{"repository":"acme/probe"}}',
    'hold a release with no version',
  ],
  [
    '{"build":"distributed","release":{"version":"1.0.0","repository":"acme"}}',
    'hold release repository "acme"',
  ],
  [
    '{"build":"distributed","release":{"version":"1.0.0","repository":"acme/probe","asset":""}}',
    'hold release asset ""',
  ],
  [
    '{"build":"distributed","release":{"version":"1.0.0","repository":"a/b/c"}}',
    'hold release repository "a/b/c"',
  ],
  [
    '{"build":"distributed","release":{"version":"1.0.0","repository":"a/b/"}}',
    'hold release repository "a/b/"',
  ],
  [
    '{"build":"distributed","release":{"version":"v1.0.0","repository":"acme/probe"}}',
    'hold release version "v1.0.0"',
  ],
  [
    '{"build":"distributed","release":{"version":"1.0.0garbage","repository":"acme/probe"}}',
    'hold release version "1.0.0garbage"',
  ],
  [
    '{"build":"distributed","release":{"version":"1.0.0","repository":"acme/probe","asset":null}}',
    'hold release asset null',
  ],
  ['{"build":"distributed","release":null}', 'hold a release that is not an object'],
])('a bundle that bakes %s names the member at fault', (facts, found) => {
  const failed = fromBundle(facts, 'node', 'facts');
  expect(failed.status).toBe(1);
  expect(failed.stderr.startsWith(invalidBanner)).toBe(true);
  expect(failed.stderr).toContain(
    `\n\nThe release facts baked into __LOOM_RELEASE__ ${found}.\n\n`,
  );
});

test('from source, a distributed override writes the generic message and a development one the Developer Diagnostic', () => {
  expect(fromSource('override-defect')).toEqual(generic);
  const failed = fromSource('override-development');
  expect(failed.status).toBe(1);
  expect(failed.stderr).toMatch(foreignThrow);
});

test('a release override core cannot read is a development build, and the run still resolves its failure', () => {
  const failed = fromSource('override-null');
  expect(failed.status).toBe(1);
  expect(failed.stderr).toMatch(foreignThrow);
  expect(printed(fromSource('override-null-invoke'))).toEqual({ exitCode: 1, status: 'failed' });
});

test("app.invoke reads the source's facts, or its host override as given, and an action's invoke reads its run's", () => {
  expect(printed(fromSource('invoke'))).toMatchObject({
    output: `${JSON.stringify({ facts: { build: 'source' }, frozen: true })}\n`,
    status: 'completed',
  });
  expect(printed(fromSource('invoke-override'))).toMatchObject({
    output: `${JSON.stringify({
      facts: {
        build: 'development',
        release: { lane: 'given', repository: 'x', version: '0' },
      },
      frozen: false,
    })}\n`,
    status: 'completed',
  });
  // The run reads a development override, and the call its action makes reads the same facts.
  expect(fromSource('nested')).toEqual({
    status: 0,
    stderr: '',
    stdout: `${JSON.stringify({ build: 'development' })}\n`,
  });
});

test.each(runtimes)(
  'a build fault writes the generic message from a distributed bundle and its diagnostic from source, and inspect() throws it in both, under %s',
  (runtime) => {
    expect(fromBundle(distributed, runtime, 'build-fault')).toEqual(generic);
    const source = fromSource('build-fault');
    expect(source.status).toBe(1);
    expect(source.stderr).toMatch(
      /^-- NOTHING TO RUN -+ @loomcli\/core\/command-without-action\n/u,
    );
    const thrown = {
      rule: '@loomcli/core/command-without-action',
      sentence: 'The root Command has no action.',
      thrown: 'DeclarationError',
    };
    expect(printed(fromBundle(distributed, runtime, 'build-fault-inspect'))).toEqual(thrown);
    expect(printed(fromSource('build-fault-inspect'))).toEqual(thrown);
  },
);

test.each(runtimes)(
  'a converter that throws is a declaration fault from source and a development bundle, and reads null in a distributed bundle, under %s',
  (runtime) => {
    const fault = { rule: '@loomcli/core/schema-converter-failed', thrown: 'DeclarationError' };
    const banner = /^-- SCHEMA CONVERTER FAILED -+ @loomcli\/core\/schema-converter-failed\n/u;
    const development = JSON.stringify({ build: 'development' });
    for (const result of [fromSource('converter'), fromBundle(development, runtime, 'converter')]) {
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(banner);
    }
    expect(printed(fromSource('converter-inspect'))).toEqual(fault);
    expect(printed(fromBundle(development, runtime, 'converter-inspect'))).toEqual(fault);
    expect(fromBundle(distributed, runtime, 'converter')).toEqual({
      status: 0,
      stderr: '',
      stdout: 'ran\n',
    });
    expect(printed(fromBundle(distributed, runtime, 'converter-inspect'))).toEqual({
      schema: null,
    });
  },
);
