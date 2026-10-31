/*
 * Acceptance plan for loom build (docs/toolchain/build.md#loom-build).
 *
 * `loom build` runs in-process on a mock process, with real Bun builds and artifact processes.
 * The CI matrix selects the runtime. Signal and watch cases retain the real toolchain process.
 *
 * - Targets. `--target node` and `--target bun` each write a bundle that reads `{ build:
 *   'distributed' }`. The host's compile target, by default and by name, writes `dist/<name>`, a
 *   binary that runs with no runtime installed. `--target browser` and an unknown target each exit
 *   with an error that names the targets. With no `--target`, a host Bun names no target for exits 1
 *   and says to pass one.
 * - The application module. A `--target node` build of a package that holds `src/application.ts`
 *   writes `dist/application.js`, which a caller imports to run the Application on the facts the
 *   build baked, and a package without it writes the entry alone. `--application` naming a module
 *   that does not exist exits 1 and names it.
 * - The build. `--build development` writes an artifact that reads `development`, and `--watch`
 *   rebuilds after a source change into an artifact that reads `development`.
 * - A release. `--release` in a package at `1.1.0-next.3` whose `repository` is the `git+https://`
 *   form reads version `1.1.0-next.3`, channel `next`, and repository `owner/name`, with an asset
 *   only for a compile target. `--repository` overrides the field. A package with no `repository`
 *   and no `--repository` exits 1 and names `--repository`. A compile target with no `bin` and no
 *   `--name` exits 1 and names `--name`.
 * - A compiled binary. `--facts` for a compile target prints `"compiled":true` with and without
 *   `--release`, and for `node` and `bun` prints no `compiled` member. A compiled fixture binary
 *   reads `host.program` as its own path alone, and a Node bundle reads `process.execPath` and the
 *   bundle's path.
 * - Composing. `--facts` prints the facts JSON and `--define` the pair, and neither writes a file.
 *   A `bun build --define` with the printed pair, and a `Bun.build` call with the printed facts,
 *   each write an artifact that reads the same facts `loom build` bakes.
 * - A failed build. A syntax error in the entry exits 1, and the earlier output is byte-identical
 *   afterward.
 *
 * Acceptance plan for one package directory (docs/toolchain/build.md#one-package-directory).
 *
 * The package directory is proven by in-process runs against fixture packages:
 *
 * - The nearest package. `loom changelog check` run in a package's `src/` validates that package's
 *   `.changes/`.
 * - A monorepo root. In a fixture workspace whose root and two member packages each hold fragments,
 *   `loom changelog check` at the root validates the root's fragments alone.
 * - No package. `loom build` in a directory with no `package.json` at or above it exits 1 and says
 *   to run it inside a package directory.
 * - An option over the convention. `loom build --entry src/cli.ts` builds that module, and with no
 *   `--entry` the build reads `src/main.ts`.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  watch as watchDirectory,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { Writable } from 'node:stream';
import { setTimeout as after } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { processHandle } from '@loomcli/core';
import { afterEach, expect, test } from 'vite-plus/test';

import { childEnvironment, start } from '../../../scripts/test-process.js';
import { removeCreatedDirectories } from '../src/helpers/build.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';
import { cli, execute, fixturePackage, loom, snapshot } from './package.js';

afterEach(() => {
  removeRoots();
});

/** How long a test that compiles a binary or watches a build may take. */
const slow = 180_000;

/** An application whose `facts` prints the release facts its run reads and whose `throw` breaks. */
const application = `import { Application, Command } from '@loomcli/core';

const label = '';

export const probe = new Application('probe', { description: 'Probe the release facts.' })
  .command(
    new Command('facts', { description: 'Print the release facts.' }).action(({ host, out }) =>
      out.print(label + JSON.stringify(host.release)),
    ),
  )
  .command(
    new Command('program', { description: 'Print the program.' }).action(({ host, out }) =>
      out.print(JSON.stringify(host.program)),
    ),
  )
  .command(
    new Command('throw', { description: 'Throw a defect.' }).action(() => {
      throw new TypeError('The probe failed.');
    }),
  );
`;

/** The entry, which runs the probe. */
const entry = `#!/usr/bin/env node
import { probe } from './application.js';

await probe.run();
`;

/** A probe package with the supplied manifest, its application module, and its entry. */
function probePackage(manifest: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  return fixturePackage({
    'package.json': `${JSON.stringify({ name: '@acme/probe', type: 'module', version: '1.0.0', ...manifest })}\n`,
    'src/application.ts': application,
    'src/main.ts': entry,
    ...files,
  });
}

/** The release facts an artifact's `facts` Command printed under one runtime. */
function factsOf(file: string, runtime?: string): unknown {
  const result = execute(file, ['facts'], runtime === undefined ? {} : { runtime });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

/** The program an artifact's `program` Command printed under one runtime, or as a binary. */
function programOf(file: string, runtime?: string): unknown {
  const result = execute(file, ['program'], runtime === undefined ? {} : { runtime });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

/** A runtime's own executable, which a bundle's `host.program` names first. */
function executableOf(runtime: string): string {
  return spawnSync(runtime, ['-e', 'process.stdout.write(process.execPath)'], {
    encoding: 'utf8',
  }).stdout;
}

/** What `loom build` printed when it built nothing but the facts. */
async function printed(root: string, args: string[]) {
  const result = await loom(root, ['build', ...args]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

const generic = { status: 1, stderr: 'probe: Something went wrong.\n', stdout: '' };

const foreignThrow =
  /^-- UNHANDLED EXCEPTION -+ @loomcli\/core\/foreign-throw\n\nThe probe failed\.\n/u;

/** The compile target Bun names for the host this test runs on. */
function hostTarget() {
  const os = process.platform;
  const report = spawnSync(
    'bun',
    ['-e', 'process.stdout.write(process.report.getReport().header.glibcVersionRuntime ?? "")'],
    { encoding: 'utf8' },
  );
  const musl = process.platform === 'linux' && report.stdout === '' ? '-musl' : '';
  return `bun-${os}-${process.arch}${musl}`;
}

test('a build outside any package fails and says to run it inside a package directory', async () => {
  const root = temporaryRoot('loom-build-');
  const result = await loom(root, ['build', '--target', 'node']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Run loom inside a package directory.');
});

test('--target node writes a bundle of the entry and the application module that reads distributed', async () => {
  const root = probePackage();
  const result = await loom(root, ['build', '--target', 'node']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const files = readdirSync(join(root, 'dist'));
  expect(files).toContain('main.js');
  expect(files).toContain('application.js');
  expect(files.filter((file) => !['application.js', 'main.js'].includes(file))).toEqual(
    expect.arrayContaining([expect.stringMatching(/^chunk-[\da-z]+\.js$/u)]),
  );
  expect(readFileSync(join(root, 'dist/main.js'), 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/u);
  {
    const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';
    expect(factsOf(join(root, 'dist/main.js'), runtime)).toEqual({ build: 'distributed' });
    expect(execute(join(root, 'dist/main.js'), ['throw'], { runtime })).toEqual(generic);
    expect(programOf(join(root, 'dist/main.js'), runtime)).toEqual([
      executableOf(runtime),
      join(root, 'dist/main.js'),
    ]);
  }
});

test('the built application module runs on a caller host with the facts the build baked', async () => {
  const root = probePackage();
  const runResult = await loom(root, ['build', '--target', 'node']);
  expect(runResult.status).toBe(0);
  const caller = join(root, 'caller.mjs');
  writeFileSync(
    caller,
    `const { probe } = await import(${JSON.stringify(pathToFileURL(join(root, 'dist/application.js')).href)});
const outcome = await probe.invoke(['facts'], {});
process.stdout.write(outcome.output);
`,
  );
  {
    const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';
    const result = execute(caller, [], { runtime });
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ build: 'distributed' });
  }
});

test('--target bun writes a bundle that reads distributed', async () => {
  const root = probePackage();
  const result = await loom(root, ['build', '--target', 'bun']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  {
    const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';
    expect(factsOf(join(root, 'dist/main.js'), runtime)).toEqual({ build: 'distributed' });
  }
});

test('--entry builds the module it names, and with no --entry the build reads src/main.ts', async () => {
  const root = probePackage(
    {},
    {
      'src/cli.ts': `#!/usr/bin/env node
import { probe } from './application.js';

process.stdout.write('cli\\n');
await probe.run();
`,
    },
  );
  const named = await loom(join(root, 'src'), ['build', '--target', 'node', '--entry', 'cli.ts']);
  expect(named.stderr).toBe('');
  expect(named.status).toBe(0);
  expect(existsSync(join(root, 'dist/main.js'))).toBe(false);
  expect(execute(join(root, 'dist/cli.js'), ['facts'], { runtime: 'node' }).stdout).toBe(
    'cli\n{"build":"distributed"}\n',
  );
  const runResult = await loom(root, ['build', '--target', 'node']);
  expect(runResult.status).toBe(0);
  expect(factsOf(join(root, 'dist/main.js'), 'node')).toEqual({ build: 'distributed' });
});

test('an entry outside src is named for its module beside the application module', async () => {
  const root = probePackage(
    {},
    {
      'bin/cli.ts': `#!/usr/bin/env node
import { probe } from '../src/application.js';

await probe.run();
`,
    },
  );
  const result = await loom(root, ['build', '--target', 'node', '--entry', 'bin/cli.ts']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const files = readdirSync(join(root, 'dist'));
  expect(files).toContain('cli.js');
  expect(files).toContain('application.js');
  expect(factsOf(join(root, 'dist/cli.js'), 'node')).toEqual({ build: 'distributed' });
});

test.each([
  ['with an application module', 'application'],
  ['without an application module', 'implementation'],
])('a nested entry, src/cli/main.ts, writes dist/main.js %s', async (_case, module) => {
  const root = fixturePackage({
    'package.json': '{"name":"nested","type":"module","version":"1.0.0"}\n',
    [`src/${module}.ts`]: application,
    'src/cli/main.ts': `#!/usr/bin/env node
import { probe } from '../${module}.js';

await probe.run();
`,
  });
  const result = await loom(root, ['build', '--target', 'node', '--entry', 'src/cli/main.ts']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(factsOf(join(root, 'dist/main.js'), 'node')).toEqual({ build: 'distributed' });
});

test.each([
  ['src/cli/application.ts', 'src/application.ts', [], 'application.js'],
  ['src/cli/index.ts', 'src/index.ts', ['--application', 'src/index.ts'], 'index.js'],
])(
  'an entry, %s, that builds to the same file as the application module fails naming both',
  async (entryPath, applicationPath, options, file) => {
    const root = fixturePackage({
      'package.json': '{"name":"twins","type":"module","version":"1.0.0"}\n',
      [applicationPath]: application,
      [entryPath]: `#!/usr/bin/env node
import { probe } from '../${applicationPath.slice('src/'.length).replace('.ts', '.js')}';

await probe.run();
`,
    });
    const result = await loom(root, [
      'build',
      '--target',
      'node',
      '--entry',
      entryPath,
      ...options,
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      `The entry ${entryPath} and the application module ${applicationPath} both build to ${file}, so rename one of them or name another module with --entry or --application.`,
    );
    expect(existsSync(join(root, 'dist'))).toBe(false);
  },
);

test.each([
  ['--entry src/application.ts', ['--entry', 'src/application.ts']],
  [
    '--entry and --application naming one module',
    ['--entry', 'src/application.ts', '--application', 'src/application.ts'],
  ],
])('%s bundles that module once and builds dist/application.js', async (_case, options) => {
  const root = probePackage({}, { 'src/application.ts': `${application}\nawait probe.run();\n` });
  const result = await loom(root, ['build', '--target', 'node', ...options]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(readdirSync(join(root, 'dist'))).toContain('application.js');
  expect(readdirSync(join(root, 'dist'))).not.toContain('main.js');
  expect(factsOf(join(root, 'dist/application.js'), 'node')).toEqual({ build: 'distributed' });
});

test('a package without src/application.ts bundles its entry alone', async () => {
  const root = fixturePackage({
    'package.json': '{"name":"solo","type":"module","version":"1.0.0"}\n',
    'src/main.ts': `${application.replace('export const', 'const')}\nawait probe.run();\n`,
  });
  const result = await loom(root, ['build', '--target', 'node']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(readdirSync(join(root, 'dist'))).toEqual(['main.js']);
  expect(factsOf(join(root, 'dist/main.js'), 'node')).toEqual({ build: 'distributed' });
});

test('--application bundles the module it names, and one that does not exist fails naming it', async () => {
  const root = probePackage({}, { 'src/app.ts': application });
  const named = await loom(root, ['build', '--target', 'node', '--application', 'src/app.ts']);
  expect(named.status).toBe(0);
  expect(readdirSync(join(root, 'dist'))).toContain('app.js');
  const missing = await loom(root, ['build', '--target', 'node', '--application', 'src/gone.ts']);
  expect(missing.status).toBe(1);
  expect(missing.stdout).toBe('');
  expect(missing.stderr).toContain('src/gone.ts');
});

test('paths.source in loom.config.json moves the entry and the application module the build reads', async () => {
  const root = fixturePackage({
    'lib/application.ts': application,
    'lib/main.ts': entry,
    'loom.config.json': '{ "paths": { "source": "lib" } }\n',
    'package.json': '{"name":"moved","type":"module","version":"1.0.0"}\n',
  });
  const result = await loom(root, ['build', '--target', 'node']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(readdirSync(join(root, 'dist'))).toEqual(
    expect.arrayContaining(['application.js', 'main.js']),
  );
  expect(factsOf(join(root, 'dist/main.js'), 'node')).toEqual({ build: 'distributed' });
});

test('with only paths.source set, a missing conventional application module leaves the entry alone', async () => {
  const root = fixturePackage({
    'lib/main.ts': `${application.replace('export const', 'const')}\nawait probe.run();\n`,
    'loom.config.json': '{ "paths": { "source": "lib" } }\n',
    'package.json': '{"name":"solo","type":"module","version":"1.0.0"}\n',
  });
  const result = await loom(root, ['build', '--target', 'node']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(readdirSync(join(root, 'dist'))).toEqual(['main.js']);
});

test('an application module paths.application names that does not exist fails the build and names the key', async () => {
  const root = probePackage(
    {},
    { 'loom.config.json': '{ "paths": { "application": "src/app.ts" } }\n' },
  );
  const result = await loom(root, ['build', '--target', 'node']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(
    'src/app.ts does not exist, so create it or name the module with paths.application.',
  );
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test('--entry and --application beat the modules loom.config.json names', async () => {
  const root = probePackage(
    {},
    {
      'loom.config.json':
        '{ "paths": { "application": "src/file-app.ts", "entry": "src/file-main.ts" } }\n',
      'src/app.ts': application,
      'src/cli.ts': entry.replace('./application.js', './app.js'),
      'src/file-app.ts': application,
      'src/file-main.ts': entry.replace('./application.js', './file-app.js'),
    },
  );
  const configured = await loom(root, ['build', '--target', 'node']);
  expect(configured.status).toBe(0);
  expect(readdirSync(join(root, 'dist'))).toEqual(
    expect.arrayContaining(['file-app.js', 'file-main.js']),
  );
  rmSync(join(root, 'dist'), { recursive: true });
  const named = await loom(root, [
    'build',
    '--target',
    'node',
    '--entry',
    'src/cli.ts',
    '--application',
    'src/app.ts',
  ]);
  expect(named.stderr).toBe('');
  expect(named.status).toBe(0);
  expect(readdirSync(join(root, 'dist')).filter((name) => name.endsWith('.js'))).toEqual(
    expect.arrayContaining(['app.js', 'cli.js']),
  );
  expect(existsSync(join(root, 'dist/file-main.js'))).toBe(false);
  expect(existsSync(join(root, 'dist/file-app.js'))).toBe(false);
});

test('an entry paths.entry names that does not exist fails the build and names the key', async () => {
  const root = probePackage({}, { 'loom.config.json': '{ "paths": { "entry": "src/cli.ts" } }\n' });
  const result = await loom(root, ['build', '--target', 'node']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(
    'src/cli.ts does not exist, so create it or name the module with paths.entry.',
  );
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test('paths.out moves the output, and --out beats it', async () => {
  const root = probePackage({}, { 'loom.config.json': '{ "paths": { "out": "build" } }\n' });
  const configured = await loom(root, ['build', '--target', 'node']);
  expect(configured.status).toBe(0);
  expect(existsSync(join(root, 'dist'))).toBe(false);
  expect(factsOf(join(root, 'build/main.js'), 'node')).toEqual({ build: 'distributed' });
  const named = await loom(root, ['build', '--target', 'node', '--out', 'other']);
  expect(named.status).toBe(0);
  expect(factsOf(join(root, 'other/main.js'), 'node')).toEqual({ build: 'distributed' });
});

test('--application with a compile target is an option error that says it applies to a bundle', async () => {
  const root = probePackage({ bin: { probe: 'dist/main.js' } });
  for (const target of [['--target', 'bun-linux-x64'], []]) {
    const result = await loom(root, ['build', ...target, '--application', 'src/application.ts']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--application applies to a node or bun bundle');
  }
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test(
  'the host compile target, by default, writes dist/<name>, a binary that runs with no runtime',
  async () => {
    const root = probePackage({
      bin: { probe: 'dist/main.js' },
      repository: 'git+https://github.com/acme/probe.git',
    });
    const result = await loom(root, ['build', '--release']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const binary = join(root, 'dist/probe');
    // An empty PATH proves the binary carries its own runtime.
    const bare = { PATH: temporaryRoot('loom-empty-path-') };
    const facts = execute(binary, ['facts'], { env: bare });
    expect(facts.stderr).toBe('');
    expect(JSON.parse(facts.stdout)).toEqual({
      build: 'distributed',
      release: {
        asset: `probe-${hostTarget().slice('bun-'.length)}`,
        channel: 'stable',
        repository: 'acme/probe',
        version: '1.0.0',
      },
    });
    expect(execute(binary, ['throw'], { env: bare })).toEqual(generic);
  },
  slow,
);

test(
  'the host compile target, by name, writes the binary its --out names',
  async () => {
    const root = probePackage();
    const result = await loom(root, ['build', '--target', hostTarget(), '--out', 'bin/named']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(factsOf(join(root, 'bin/named'))).toEqual({ build: 'distributed' });
    // A compiled binary is the whole program, so its program is its own path alone.
    expect(programOf(join(root, 'bin/named'))).toEqual([realpathSync(join(root, 'bin/named'))]);
  },
  slow,
);

test(
  'the host compile target, by name with no --out, writes dist/<name>',
  async () => {
    const root = probePackage({ bin: { notes: 'dist/main.js' } });
    const result = await loom(root, ['build', '--target', hostTarget()]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`Built dist/notes for ${hostTarget()}.\n`);
    expect(factsOf(join(root, 'dist/notes'))).toEqual({ build: 'distributed' });
  },
  slow,
);

test('a compile target whose output is an existing directory fails before building and names --out', async () => {
  const root = probePackage({ bin: { probe: 'dist/main.js' } });
  put(root, 'dist/notes.txt', 'Not the build’s.\n');
  const before = snapshot(join(root, 'dist'));
  const result = await loom(root, ['build', '--target', 'bun-linux-x64', '--out', 'dist']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--out');
  expect(result.stderr).not.toContain('EISDIR');
  expect(result.stderr).not.toContain('.loom-build-');
  expect(snapshot(join(root, 'dist'))).toEqual(before);
});

test.each([
  ['browser', /browser/u],
  ['bun-plan9-x64', /bun-plan9-x64/u],
  ['deno', /deno/u],
  ['bun-linux-x64-foo', /bun-linux-x64-foo/u],
  ['bun-darwin-arm64-musl', /bun-darwin-arm64-musl/u],
  ['bun-windows-x64', /bun-windows-x64/u],
])('--target %s exits with an error that names the targets', async (target, named) => {
  const root = probePackage({ bin: { probe: 'dist/main.js' }, repository: 'acme/probe' });
  for (const print of [[], ['--release', '--facts'], ['--define']]) {
    const result = await loom(root, ['build', '--target', target, ...print]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(named);
    expect(result.stderr).toContain('node, bun, or a Bun compile target');
    expect(result.stderr).toContain('for linux or darwin on x64 or arm64');
  }
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test('a build with no --target on a host Bun names no target for fails and says to pass one', async () => {
  const root = probePackage({ bin: { probe: 'dist/main.js' } });
  const { loom: toolchain } = await import('../src/application.js');
  const written: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      written.push(String(chunk));
      done();
    },
  });
  const status = await toolchain.run({
    process: processHandle({
      argv: ['build'],
      cwd: root,
      platform: 'win32',
      stderr: sink,
      stdout: sink,
    }),
  });
  expect(status).toBe(1);
  expect(written.join('')).toContain(
    `Bun compiles for no target on this host (bun-win32-${process.arch}), so pass --target.`,
  );
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test('a Bun compile target with its variants names its asset with them', async () => {
  const root = probePackage({ bin: { probe: 'dist/main.js' }, repository: 'acme/probe' });
  const facts = await printed(root, [
    '--target',
    'bun-linux-x64-musl-baseline',
    '--release',
    '--facts',
  ]);
  expect(JSON.parse(facts)).toMatchObject({
    release: { asset: 'probe-linux-x64-musl-baseline' },
  });
});

test('--build development writes an artifact that reads development and shows its author a defect', async () => {
  const root = probePackage();
  const runResult = await loom(root, ['build', '--target', 'node', '--build', 'development']);
  expect(runResult.status).toBe(0);
  {
    const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';
    expect(factsOf(join(root, 'dist/main.js'), runtime)).toEqual({ build: 'development' });
    const failed = execute(join(root, 'dist/main.js'), ['throw'], { runtime });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(foreignThrow);
  }
});

test('--build takes development or distributed alone', async () => {
  const root = probePackage();
  const result = await loom(root, ['build', '--target', 'node', '--build', 'source']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('development or distributed');
});

test(
  '--watch rebuilds after a source change into an artifact that reads development',
  async () => {
    const root = probePackage();
    const main = join(root, 'dist/main.js');
    const watcher = start(pathToFileURL(cli), ['build', '--watch', '--target', 'node'], {
      cwd: root,
    });
    try {
      await until(
        () => existsSync(main) && execute(main, ['facts'], { runtime: 'node' }).status === 0,
      );
      expect(factsOf(main, 'node')).toEqual({ build: 'development' });
      writeFileSync(
        join(root, 'src/application.ts'),
        application.replace("const label = '';", "const label = 'changed ';"),
      );
      await until(() =>
        execute(main, ['facts'], { runtime: 'node' }).stdout.startsWith('changed '),
      );
      expect(execute(main, ['facts'], { runtime: 'node' }).stdout).toBe(
        'changed {"build":"development"}\n',
      );
    } finally {
      watcher.child.kill('SIGTERM');
      await watcher.exit;
    }
    // Stopping loom stops the Bun watcher it runs, so no process still names the entry.
    await until(() => spawnSync('pgrep', ['-f', join(root, 'src/main.ts')]).status === 1);
  },
  slow,
);

test(
  '--watch rebuilds after a source file is replaced, as an atomic save or a checkout replaces it',
  async () => {
    const root = probePackage();
    const main = join(root, 'dist/main.js');
    const module = join(root, 'src/application.ts');
    const watcher = start(pathToFileURL(cli), ['build', '--watch', '--target', 'node'], {
      cwd: root,
    });
    const labelled = (text: string) => () =>
      execute(main, ['facts'], { runtime: 'node' }).stdout.startsWith(text);
    try {
      await until(
        () => existsSync(main) && execute(main, ['facts'], { runtime: 'node' }).status === 0,
      );
      writeFileSync(
        join(root, 'src/saved.ts'),
        application.replace("const label = '';", "const label = 'saved ';"),
      );
      renameSync(join(root, 'src/saved.ts'), module);
      await until(labelled('saved '));
      expect(execute(main, ['facts'], { runtime: 'node' }).stdout).toBe(
        'saved {"build":"development"}\n',
      );
      rmSync(module);
      writeFileSync(module, application.replace("const label = '';", "const label = 'checked ';"));
      await until(labelled('checked '));
      expect(execute(main, ['facts'], { runtime: 'node' }).stdout).toBe(
        'checked {"build":"development"}\n',
      );
    } finally {
      watcher.child.kill('SIGTERM');
      await watcher.exit;
    }
  },
  slow,
);

test('--watch with --build distributed is an option error', async () => {
  const root = probePackage();
  const result = await loom(root, [
    'build',
    '--watch',
    '--build',
    'distributed',
    '--target',
    'node',
  ]);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--watch');
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test.each([
  ['1.1.0-next.3', 'next'],
  ['2.0.0', 'stable'],
])(
  '--release in a package at %s reads its version, channel %s, and repository with no asset',
  async (version, channel) => {
    const root = probePackage({ repository: 'git+https://github.com/acme/probe.git', version });
    const runResult = await loom(root, ['build', '--target', 'node', '--release']);
    expect(runResult.status).toBe(0);
    {
      const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';
      expect(factsOf(join(root, 'dist/main.js'), runtime)).toEqual({
        build: 'distributed',
        release: { channel, repository: 'acme/probe', version },
      });
      expect(execute(join(root, 'dist/main.js'), ['throw'], { runtime })).toEqual(generic);
    }
  },
);

test('--repository overrides the repository field', async () => {
  const root = probePackage({ repository: 'git+https://github.com/acme/probe.git' });
  const runResult = await loom(root, [
    'build',
    '--target',
    'node',
    '--release',
    '--repository',
    'other/fork',
  ]);
  expect(runResult.status).toBe(0);
  expect(factsOf(join(root, 'dist/main.js'), 'node')).toEqual({
    build: 'distributed',
    release: { channel: 'stable', repository: 'other/fork', version: '1.0.0' },
  });
});

test.each([
  ['the git+https form', 'git+https://github.com/acme/probe.git'],
  ['an https address', 'https://github.com/acme/probe'],
  ['the ssh form', 'git@github.com:acme/probe.git'],
  ['a git+ssh address with a path after the host', 'git+ssh://git@github.com/acme/probe.git'],
  ['a git+ssh address with an scp-style path', 'git+ssh://git@github.com:acme/probe.git'],
  ['the owner/name shorthand', 'acme/probe'],
  ['the github: shorthand', 'github:acme/probe'],
  ['an object with a url', { type: 'git', url: 'git+https://github.com/acme/probe.git' }],
])('--release reads the repository from %s', async (_form, repository) => {
  const root = probePackage({ repository });
  expect(JSON.parse(await printed(root, ['--target', 'node', '--release', '--facts']))).toEqual({
    build: 'distributed',
    release: { repository: 'acme/probe', version: '1.0.0' },
  });
});

test('--release with no repository field and no --repository exits 1 and names --repository', async () => {
  const root = probePackage();
  const result = await loom(root, ['build', '--target', 'node', '--release']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--repository');
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test('--release with a repository field it cannot read exits 1 and names --repository', async () => {
  const root = probePackage({ repository: 'https://example.com/' });
  const result = await loom(root, ['build', '--target', 'node', '--release']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('--repository');
});

test.each([
  ['a nested group', 'https://gitlab.com/group/sub/notes.git'],
  ['a path below the repository', 'https://github.com/acme/notes/tree/main/x'],
])(
  '--release with a repository field naming %s exits 1 and names --repository',
  async (_case, url) => {
    const root = probePackage({ repository: url });
    const result = await loom(root, ['build', '--target', 'node', '--release', '--facts']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--repository');
  },
);

test('--repository without --release is an option error that says it applies to a release', async () => {
  const root = probePackage();
  const result = await loom(root, ['build', '--target', 'node', '--repository', 'acme/probe']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--repository applies to a --release build');
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test('--release with no version exits 1 and names the version field', async () => {
  const root = probePackage({ repository: 'acme/probe', version: undefined });
  const result = await loom(root, ['build', '--target', 'node', '--release']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('version');
  expect(result.stderr).toContain('package.json');
});

test('a compile target with no bin and no --name exits 1 and names --name', async () => {
  const root = probePackage();
  const result = await loom(root, ['build', '--target', 'bun-linux-x64']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--name');
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test.each([
  ['a string bin, the package name without its scope', { bin: 'dist/main.js' }, [], 'probe'],
  ['an object bin with one key, that key', { bin: { notes: 'dist/main.js' } }, [], 'notes'],
  ['--name over the bin', { bin: { notes: 'dist/main.js' } }, ['--name', 'jot'], 'jot'],
  ['--name with no bin', {}, ['--name', 'jot'], 'jot'],
])('a compile target names its asset from %s', async (_case, manifest, args, name) => {
  const root = probePackage({ repository: 'acme/probe', ...manifest });
  const facts = await printed(root, [
    '--target',
    'bun-linux-x64-musl',
    '--release',
    '--facts',
    ...args,
  ]);
  expect(JSON.parse(facts)).toEqual({
    build: 'distributed',
    compiled: true,
    release: { asset: `${name}-linux-x64-musl`, repository: 'acme/probe', version: '1.0.0' },
  });
});

test('--facts for a compile target prints compiled true with and without --release, and for node and bun prints none', async () => {
  const root = probePackage({ bin: { probe: 'dist/main.js' }, repository: 'acme/probe' });
  await expect(printed(root, ['--target', 'bun-linux-x64', '--facts'])).resolves.toBe(
    '{"build":"distributed","compiled":true}\n',
  );
  await expect(
    printed(root, ['--target', 'bun-darwin-arm64', '--release', '--facts']),
  ).resolves.toBe(
    '{"build":"distributed","compiled":true,"release":{"asset":"probe-darwin-arm64","repository":"acme/probe","version":"1.0.0"}}\n',
  );
  await expect(printed(root, ['--target', 'bun-linux-x64', '--define'])).resolves.toBe(
    '__LOOM_RELEASE__={"build":"distributed","compiled":true}\n',
  );
  for (const target of ['node', 'bun']) {
    await expect(printed(root, ['--target', target, '--facts'])).resolves.toBe(
      '{"build":"distributed"}\n',
    );
    await expect(
      printed(root, ['--target', target, '--release', '--facts']),
    ).resolves.not.toContain('compiled');
  }
});

test('an object bin with several keys and no --name names --name', async () => {
  const root = probePackage({
    bin: { one: 'dist/one.js', two: 'dist/two.js' },
    repository: 'acme/probe',
  });
  const result = await loom(root, ['build', '--target', 'bun-linux-x64', '--release', '--facts']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('--name');
});

test('--facts and --define each print one line, write no file, and compose a build that reads the same facts', async () => {
  const root = probePackage({ repository: 'acme/probe', version: '1.1.0-next.3' });
  const args = ['--target', 'node', '--release', '--build', 'development'];
  const facts = await printed(root, [...args, '--facts']);
  const define = await printed(root, [...args, '--define']);
  expect(existsSync(join(root, 'dist'))).toBe(false);
  expect(facts.split('\n')).toHaveLength(2);
  expect(JSON.parse(facts)).toEqual({
    build: 'development',
    release: { repository: 'acme/probe', version: '1.1.0-next.3' },
  });
  expect(define).toBe(`__LOOM_RELEASE__=${facts}`);
  const expected = {
    build: 'development',
    release: { channel: 'next', repository: 'acme/probe', version: '1.1.0-next.3' },
  };
  const runResult = await loom(root, ['build', ...args]);
  expect(runResult.status).toBe(0);
  expect(factsOf(join(root, 'dist/main.js'), 'node')).toEqual(expected);
  const command = spawnSync(
    'bun',
    [
      'build',
      'src/main.ts',
      '--outdir',
      'by-command',
      '--target',
      'node',
      '--define',
      define.trim(),
    ],
    { cwd: root, encoding: 'utf8' },
  );
  expect(command.status).toBe(0);
  expect(factsOf(join(root, 'by-command/main.js'), 'node')).toEqual(expected);
  put(
    root,
    'compose.mjs',
    `const result = await Bun.build({
  define: { __LOOM_RELEASE__: process.argv[2] },
  entrypoints: ['src/main.ts'],
  outdir: 'by-api',
  target: 'node',
});
process.exitCode = result.success ? 0 : 1;
`,
  );
  const api = spawnSync('bun', ['compose.mjs', facts.trim()], { cwd: root, encoding: 'utf8' });
  expect(api.status).toBe(0);
  expect(factsOf(join(root, 'by-api/main.js'), 'node')).toEqual(expected);
});

test('--facts and --define exclude each other', async () => {
  const root = probePackage();
  const result = await loom(root, ['build', '--target', 'node', '--facts', '--define']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--facts');
  expect(result.stderr).toContain('--define');
});

test('a syntax error in the entry exits 1 and leaves the earlier output byte-identical', async () => {
  const root = probePackage();
  const runResult = await loom(root, ['build', '--target', 'node']);
  expect(runResult.status).toBe(0);
  put(root, 'dist/notes.txt', 'Not the build’s.\n');
  const before = snapshot(join(root, 'dist'));
  writeFileSync(join(root, 'src/main.ts'), 'const broken = ;\n');
  const result = await loom(root, ['build', '--target', 'node']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('src/main.ts');
  expect(snapshot(join(root, 'dist'))).toEqual(before);
  expect(readdirSync(root).toSorted()).toEqual(['dist', 'node_modules', 'package.json', 'src']);
});

test('a failed first build leaves no dist directory behind', async () => {
  const root = probePackage();
  writeFileSync(join(root, 'src/main.ts'), 'const broken = ;\n');
  const result = await loom(root, ['build', '--target', 'node']);
  expect(result.status).toBe(1);
  expect(readdirSync(root).toSorted()).toEqual(['node_modules', 'package.json', 'src']);
});

test.each(['SIGINT', 'SIGTERM'] as const)(
  'a %s to loom alone while Bun compiles stops Bun, removes the staging directory, and leaves the earlier output',
  async (signal) => {
    const root = probePackage({ bin: { probe: 'dist/main.js' } });
    put(root, 'dist/probe', 'An earlier binary.\n');
    put(root, 'dist/notes.txt', 'Not the build’s.\n');
    const before = snapshot(join(root, 'dist'));
    const received = await signalWhenWritten(
      root,
      signal,
      root,
      (name) => name.endsWith('.bun-build'),
      ['--target', hostTarget()],
      true,
    );
    // A process that ends on the signal it received reads 128 plus the signal's number to its shell.
    expect(received).toBe(signal);
    expect(snapshot(join(root, 'dist'))).toEqual(before);
    expect(temporaryLeftovers(root)).toEqual([]);
    // Loom stops the Bun it runs, so no process still names the package.
    await until(() => spawnSync('pgrep', ['-f', root]).status === 1);
  },
  slow,
);

/**
 * Runs `loom build` with the arguments, `--target node` unless told otherwise, in the package as its
 * own process group and sends the signal the moment an entry the predicate names appears anywhere
 * under the watched directory, by its path relative to that directory, so the signal lands as soon
 * as the build has started writing, whatever the machine's speed. The signal goes to the group, as
 * a terminal's Ctrl-C sends it, or with `loomAlone` to `loom` alone, as `kill` or a task runner
 * sends it. It resolves to the signal the build ended by.
 */
async function signalWhenWritten(
  root: string,
  signal: NodeJS.Signals,
  watched: string,
  written: (name: string) => boolean,
  args: readonly string[] = ['--target', 'node'],
  loomAlone = false,
): Promise<NodeJS.Signals | null> {
  const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';
  const watcher = watchDirectory(watched, { recursive: true });
  const child = spawn(runtime, [cli, 'build', ...args], {
    cwd: root,
    detached: true,
    env: childEnvironment(undefined),
    stdio: 'ignore',
  });
  const ended = new Promise<NodeJS.Signals | null>((resolve) => {
    child.on('close', (_status, received) => {
      resolve(received);
    });
  });
  watcher.on('change', (_event, name) => {
    if (typeof name === 'string' && written(name)) {
      watcher.close();
      process.kill(loomAlone ? (child.pid ?? 0) : -(child.pid ?? 0), signal);
    }
  });
  try {
    return await ended;
  } finally {
    watcher.close();
  }
}

/**
 * Every path under the package outside `node_modules`, files and directories alike, relative to
 * it, that a build's or a watch's temporary work would leave: a `.bun-build` file, other than the
 * test's own `unrelated.bun-build`, or a `.loom-build-` or `.loom-watch-` directory.
 */
function temporaryLeftovers(root: string) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .map((found) => relative(root, join(found.parentPath, found.name)))
    .filter((path) => path !== 'node_modules' && !path.startsWith(`node_modules${sep}`))
    .filter(
      (path) =>
        (path.endsWith('.bun-build') && path !== 'unrelated.bun-build') ||
        /^\.loom-(?:build|watch)-/u.test(basename(path)),
    );
}

test('undoing a build removes only the directories it created that nothing else has filled', () => {
  const root = temporaryRoot('loom-undo-');
  // A build created out/dist/bin, and a build running beside it wrote into out/dist.
  const created = mkdirSync(join(root, 'out/dist/bin'), { recursive: true });
  writeFileSync(join(root, 'out/dist/other.js'), '');
  removeCreatedDirectories(join(root, 'out/dist/bin'), created);
  expect(readdirSync(join(root, 'out/dist'))).toEqual(['other.js']);
});

/** Every file a complete build of the probe package writes, read from one uninterrupted build. */
async function completeBuild(root: string) {
  const runResult = await loom(root, ['build', '--target', 'node']);
  expect(runResult.status).toBe(0);
  const built = snapshot(join(root, 'dist'));
  rmSync(join(root, 'dist'), { recursive: true });
  return built;
}

test.each(['SIGINT', 'SIGTERM'] as const)(
  'a %s the moment a first build creates its output removes the output, or ends once the build is complete',
  async (signal) => {
    const root = probePackage();
    const built = await completeBuild(root);
    for (let round = 0; round < 3; round += 1) {
      const received = await signalWhenWritten(root, signal, root, (name) => name === 'dist');
      expect(received).toBe(signal);
      const left = existsSync(join(root, 'dist')) ? snapshot(join(root, 'dist')) : undefined;
      expect([undefined, built]).toContainEqual(left);
      rmSync(join(root, 'dist'), { force: true, recursive: true });
      expect(readdirSync(root).toSorted()).toEqual(['node_modules', 'package.json', 'src']);
    }
  },
  slow,
);

test.each(['SIGINT', 'SIGTERM'] as const)(
  'a %s the moment a rebuild creates its staging directory leaves the earlier output whole, or the new output whole',
  async (signal) => {
    const root = probePackage();
    const built = await completeBuild(root);
    const stale = () => {
      for (const file of built.keys()) {
        put(root, join('dist', file), `An earlier ${file}.\n`);
      }
      put(root, 'dist/notes.txt', 'Not the build’s.\n');
      return snapshot(join(root, 'dist'));
    };
    const before = stale();
    const rebuilt = new Map([...built, ['notes.txt', before.get('notes.txt') ?? '']]);
    for (let round = 0; round < 3; round += 1) {
      const received = await signalWhenWritten(root, signal, join(root, 'dist'), (name) =>
        name.startsWith('.loom-build-'),
      );
      expect(received).toBe(signal);
      expect([before, rebuilt]).toContainEqual(snapshot(join(root, 'dist')));
      expect(
        readdirSync(join(root, 'dist')).filter((file) => file.startsWith('.loom-build-')),
      ).toEqual([]);
      stale();
    }
  },
  slow,
);

test.each(['SIGINT', 'SIGTERM'] as const)(
  'a %s while Bun writes its compile file leaves no .bun-build file in the package and the earlier binary whole',
  async (signal) => {
    const root = probePackage({ bin: { probe: 'dist/main.js' } });
    put(root, 'dist/probe', 'An earlier binary.\n');
    put(root, 'unrelated.bun-build', 'Not the build’s.\n');
    const before = snapshot(join(root, 'dist'));
    for (let round = 0; round < 2; round += 1) {
      const received = await signalWhenWritten(
        root,
        signal,
        root,
        (name) => name.endsWith('.bun-build') && name !== 'unrelated.bun-build',
        ['--target', hostTarget()],
      );
      expect(received).toBe(signal);
      expect(snapshot(join(root, 'dist'))).toEqual(before);
      expect(temporaryLeftovers(root)).toEqual([]);
      expect(readdirSync(root).toSorted()).toEqual([
        'dist',
        'node_modules',
        'package.json',
        'src',
        'unrelated.bun-build',
      ]);
      expect(readFileSync(join(root, 'unrelated.bun-build'), 'utf8')).toBe('Not the build’s.\n');
    }
  },
  slow,
);

test.each(['SIGINT', 'SIGTERM'] as const)(
  'a %s while a --watch compile writes its compile file leaves no .bun-build file and no watch directory in the package',
  async (signal) => {
    const root = probePackage({ bin: { probe: 'dist/main.js' } });
    put(root, 'unrelated.bun-build', 'Not the build’s.\n');
    for (let round = 0; round < 2; round += 1) {
      const received = await signalWhenWritten(
        root,
        signal,
        root,
        (name) => name.endsWith('.bun-build') && name !== 'unrelated.bun-build',
        ['--watch', '--target', hostTarget()],
      );
      expect(received).toBe(signal);
      expect(temporaryLeftovers(root)).toEqual([]);
      // The watch wrote nothing before the signal, so the dist directory it created goes too.
      expect(readdirSync(root).toSorted()).toEqual([
        'node_modules',
        'package.json',
        'src',
        'unrelated.bun-build',
      ]);
      expect(readFileSync(join(root, 'unrelated.bun-build'), 'utf8')).toBe('Not the build’s.\n');
    }
  },
  slow,
);

test(
  'a bundle --watch leaves alone a .bun-build file another compile writes in the package while it watches',
  async () => {
    const root = probePackage();
    const main = join(root, 'dist/main.js');
    const watcher = start(pathToFileURL(cli), ['build', '--watch', '--target', 'node'], {
      cwd: root,
    });
    try {
      await until(() => existsSync(main));
      put(root, '.other-00000000.bun-build', 'Another compile’s.\n');
    } finally {
      watcher.child.kill('SIGTERM');
      await watcher.exit;
    }
    expect(readFileSync(join(root, '.other-00000000.bun-build'), 'utf8')).toBe(
      'Another compile’s.\n',
    );
  },
  slow,
);

test(
  'two host compiles in one package with different --out both succeed and both binaries run',
  async () => {
    const root = probePackage();
    for (let round = 0; round < 3; round += 1) {
      const builds = ['dist/a', 'dist/b'].map((out) =>
        start(pathToFileURL(cli), ['build', '--target', hostTarget(), '--out', out], {
          cwd: root,
        }),
      );
      const ended = await Promise.all(builds.map((build) => build.exit));
      for (const result of ended) {
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
      }
      expect(factsOf(join(root, 'dist/a'))).toEqual({ build: 'distributed' });
      expect(factsOf(join(root, 'dist/b'))).toEqual({ build: 'distributed' });
      expect(temporaryLeftovers(root)).toEqual([]);
      rmSync(join(root, 'dist'), { recursive: true });
    }
  },
  slow,
);

/**
 * A package whose entry prints the mode its dependency resolved and the `NODE_ENV` its bundle
 * reads. The dependency ships a development build beside its default, as micromark does.
 */
function modesPackage() {
  return fixturePackage({
    'node_modules/modes/development.js': "export const mode = 'development';\n",
    // Conditions match in the order they are written, so `development` comes before `default`.
    'node_modules/modes/package.json':
      '{"exports":{".":{"development":"./development.js","default":"./production.js"}},"name":"modes","type":"module","version":"1.0.0"}\n',
    'node_modules/modes/production.js': "export const mode = 'production';\n",
    'package.json': '{"name":"modes-probe","type":"module","version":"1.0.0"}\n',
    'src/main.ts': `// @ts-expect-error The fixture dependency ships no declarations.
import { mode } from 'modes';

process.stdout.write(\`\${mode} \${process.env.NODE_ENV}\\n\`);
`,
  });
}

test('a distributed bundle reads production code from its dependencies, whatever NODE_ENV the build ran under', async () => {
  const root = modesPackage();
  const result = await loom(root, ['build', '--target', 'node'], {
    env: { NODE_ENV: 'development' },
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const run = execute(join(root, 'dist/main.js'), [], {
    env: childEnvironment({ NODE_ENV: undefined }),
    runtime: 'node',
  });
  expect(run.stdout).toBe('production production\n');
});

test('a development bundle reads the development code its dependencies ship', async () => {
  const root = modesPackage();
  const built = await loom(root, ['build', '--target', 'node', '--build', 'development'], {
    env: { NODE_ENV: undefined },
  });
  expect(built.status).toBe(0);
  const run = execute(join(root, 'dist/main.js'), [], {
    env: childEnvironment({ NODE_ENV: undefined }),
    runtime: 'node',
  });
  expect(run.stdout).toBe('development development\n');
});

test(
  'a compiled binary reads production code from its dependencies in a distributed build and development code in a development one',
  async () => {
    const root = modesPackage();
    const shell = { NODE_ENV: undefined };
    for (const [build, expected] of [
      ['distributed', 'production production\n'],
      ['development', 'development development\n'],
    ] as const) {
      const built = await loom(root, ['build', '--name', 'modes', '--build', build], {
        env: shell,
      });
      expect(built.status).toBe(0);
      const run = execute(join(root, 'dist/modes'), [], { env: childEnvironment(shell) });
      expect(run.stdout).toBe(expected);
    }
  },
  slow,
);

test("a build reads the package's bunfig.toml, whose loader setting applies to the bundle", async () => {
  const root = fixturePackage({
    'bunfig.toml': '[loader]\n".greeting" = "text"\n',
    'package.json': '{"name":"greeter","type":"module","version":"1.0.0"}\n',
    'src/hello.greeting': 'Hello from the loader.\n',
    'src/main.ts': `// @ts-expect-error A .greeting file has no type declaration.
import greeting from './hello.greeting';

process.stdout.write(greeting);
`,
  });
  const result = await loom(root, ['build', '--target', 'node']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(execute(join(root, 'dist/main.js'), [], { runtime: 'node' }).stdout).toBe(
    'Hello from the loader.\n',
  );
});

test('a rebuild replaces the files it writes and leaves every other file alone', async () => {
  const root = probePackage();
  put(root, 'dist/notes.txt', 'Not the build’s.\n');
  put(root, 'dist/main.js', 'stale\n');
  const runResult = await loom(root, ['build', '--target', 'node']);
  expect(runResult.status).toBe(0);
  expect(readFileSync(join(root, 'dist/notes.txt'), 'utf8')).toBe('Not the build’s.\n');
  expect(factsOf(join(root, 'dist/main.js'), 'node')).toEqual({ build: 'distributed' });
});

test('a build with no Bun on the PATH exits 1 and names Bun', async () => {
  const root = probePackage();
  const runtime = spawnSync(process.env.LOOM_TEST_RUNTIME ?? 'node', ['-p', 'process.execPath'], {
    encoding: 'utf8',
  }).stdout.trim();
  const result = await loom(root, ['build', '--target', 'node'], {
    env: { PATH: temporaryRoot('loom-empty-path-') },
    runtime,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Bun');
});

/** Waits until a condition holds, polling, so a watcher's rebuild is observed when it lands. */
async function until(condition: () => boolean) {
  const deadline = Date.now() + 60_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('The condition never held.');
    }
    await after(100);
  }
}
