/*
 * Acceptance plan for release facts (docs/core/release-facts.md#release-facts).
 *
 * Release facts are proven when public APIs and process runs alone produce these results:
 *
 * - Operator failures. A fixture whose `get` Command lacks its required argument writes the same
 *   usage error and exits 2, from source and from bundles baking a distributed and a development
 *   build, under Node and Bun, because an operator's failure prints the same bytes in every build.
 * - A source run. A fixture action that prints `host.release` prints `{ build: 'source' }` from
 *   source. When the action throws a `TypeError` instead, the run writes the Developer Diagnostic
 *   of `@loomcli/core/foreign-throw` and exits 1.
 * - A bundle with facts. The fixture bundled by `loom build --target node` prints `{ build:
 *   'distributed' }` with no release group, and its throwing action writes exactly `probe:
 *   Something went wrong.` and exits 1, with no reason, class name, or path on stderr. Built with
 *   `--build development`, it prints `development` and writes the Developer Diagnostic. Built with
 *   `--release` from a package at `1.1.0-next.3` whose `repository` reads
 *   `git+https://github.com/acme/probe.git`, it prints version `1.1.0-next.3`, channel `next`, and
 *   repository `acme/probe`, with no asset, and a package at `2.0.0` reads channel `stable`. A
 *   compiled binary built with `loom build --release` for the host target reads its asset name and
 *   writes the generic message.
 * - A bundle without facts. A packed consumer bundles a fixture application with `Bun.build` and
 *   with Rolldown, each with no define. Each bundle reads `{ build: 'source' }` and writes the
 *   Developer Diagnostic for a defect under Node and Bun. Each pads wide, combining, emoji, and
 *   flag text to its display width and keeps the license notices of core's derived modules.
 * - A malformed define. A fixture bundled with `--define` values that bake `{"build":"staging"}`,
 *   `[]`, a release group whose version is `one`, and `"compiled":1` each exits 1 with the
 *   Developer Diagnostic of `@loomcli/core/invalid-release-facts` and runs no action. `app.invoke`
 *   from the same bundle resolves `failed` with exit 1, `inspect()` throws the `InternalError`, and
 *   `run({ process: processHandle({ release: { build: 'distributed' } }) })` runs, because the override replaces the
 *   baked value. A baked member core does not know reads as the known members alone.
 * - Overrides by build. From source, `run({ process: processHandle({ release: { build: 'distributed' } }) })` writes
 *   the generic message for a defect and `{ build: 'development' }` writes the Developer
 *   Diagnostic. An application override of `InternalError` renders a defect in a distributed build
 *   and is not consulted in a development build; a plugin override of `InternalError` is likewise
 *   not consulted in development. An `onFailure` hint prints under the generic message and under
 *   the Developer Diagnostic. An action's `invoke` reads its run's facts, and `app.invoke` with
 *   `process: processHandle({ release })` reads the override.
 * - Build faults. A root with neither children nor an action writes the generic message from a
 *   distributed bundle and its Developer Diagnostic from source, both with exit 1, and `inspect()`
 *   throws the `DeclarationError` in both.
 * - Broken contracts. A broken failure view and a throwing `onFailure` hook each write the
 *   failure's own text and then one generic line in a distributed build, and the broken contract's
 *   Developer Diagnostic in a development build, with exit 1, or 130 in a run a caller cancelled.
 * - The converter. A validated input whose converter throws is a `DeclarationError` from `run()`
 *   and `inspect()` from source and from a `--build development` bundle, and reads `null` in a
 *   distributed bundle.
 * - The packed consumer. A packed consumer installs `@loomcli/core` and `@loomcli/loom`, compiles
 *   an action that reads `host.release` against core's emitted declarations with `skipLibCheck`
 *   off, runs `loom build --target node` in its fixture package, and the bundle reads `distributed`
 *   under Node and Bun while the source reads `source`. `@loomcli/loom` exports no `./build`
 *   subpath.
 *
 * Each case runs under Node and Bun, except the source runs, which run under Bun.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
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

// The root is resolved through symbolic links, because macOS's temporary directory is a link and
// Bun resolves the script path it reports, so host.program names the resolved bundle.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'loom-release-')));

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

const usageError = {
  status: 2,
  stderr: 'probe: Argument "path" requires a value. Supply a value for "path".\n',
  stdout: '',
};

test.each(runtimes)(
  'an operator failure prints the same bytes from source and from distributed and development bundles under %s',
  (runtime) => {
    expect(fromSource('usage')).toEqual(usageError);
    expect(fromBundle(distributed, runtime, 'usage')).toEqual(usageError);
    expect(fromBundle(JSON.stringify({ build: 'development' }), runtime, 'usage')).toEqual(
      usageError,
    );
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
  'a bundle that bakes release %s reads channel %s, which core derives, with no asset',
  (version, channel) => {
    const facts = JSON.stringify({
      build: 'distributed',
      release: { repository: 'acme/probe', version },
    });
    for (const runtime of runtimes) {
      expect(printed(fromBundle(facts, runtime, 'facts'))).toEqual({
        facts: { build: 'distributed', release: { channel, repository: 'acme/probe', version } },
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
        release: { channel: 'stable', repository: 'acme/probe', version: '1.0.0' },
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
  ['{"build":"distributed","compiled":1}', 'hold compiled 1'],
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

test("app.invoke reads the source's facts, or its handle's facts as given, and an action's invoke reads its run's", () => {
  expect(printed(fromSource('invoke'))).toMatchObject({
    output: `${JSON.stringify({ facts: { build: 'source' }, frozen: true })}\n`,
    status: 'completed',
  });
  expect(printed(fromSource('invoke-override'))).toMatchObject({
    output: `${JSON.stringify({
      facts: {
        build: 'development',
        release: { channel: 'given', repository: 'x', version: '0' },
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

/** The runtime's own executable, which `host.program` names first. */
function executableOf(runtime: string): string {
  return run(runtime, ['-e', 'process.stdout.write(process.execPath)']).stdout;
}

test.each(runtimes)(
  'a bundle reads host.program as the runtime and the bundle, frozen, and one that bakes compiled true as the runtime alone, under %s',
  (runtime) => {
    const executable = executableOf(runtime);
    const main = bundled(distributed);
    expect(printed(fromBundle(distributed, runtime, 'program'))).toEqual({
      frozen: true,
      program: [executable, main],
    });
    const compiled = JSON.stringify({ build: 'distributed', compiled: true });
    expect(printed(fromBundle(compiled, runtime, 'program'))).toEqual({
      frozen: true,
      program: [executable],
    });
    // The release facts never repeat the member.
    expect(printed(fromBundle(compiled, runtime, 'facts'))).toEqual({
      facts: { build: 'distributed' },
      frozen: true,
    });
    expect(printed(fromBundle(compiled, runtime, 'program-invoke'))).toEqual({
      frozen: true,
      program: [executable],
    });
  },
);

test('a source run reads host.program as the runtime and the absolute script path', () => {
  const result = fromSource('program');
  expect(printed(result)).toEqual({
    frozen: true,
    program: [executableOf('bun'), fileURLToPath(fixture)],
  });
});

test('a program override replaces the whole list, copied and frozen, and an action invoke keeps it', () => {
  expect(printed(fromSource('program-override'))).toEqual({
    frozen: true,
    program: ['/opt/runtime', '/srv/main.js'],
  });
  expect(printed(fromSource('program-nested'))).toEqual(['/opt/runtime', '/srv/main.js']);
});
