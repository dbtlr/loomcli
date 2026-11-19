/*
 * Acceptance plan for turning on the npm launcher packages (ADR-0213, docs/toolchain/build.md#the-npm-launcher-packages).
 *
 * Each case runs `loom build` in-process on a mock process, and none compiles a binary.
 *
 * - The file's `npm` key. An empty `platforms` list, an entry outside the six release asset
 *   platforms, a repeated entry, and `platforms` without `launcher: true` each fail the run with code
 *   2 and name `npm.platforms`.
 * - No key (proof 2). `--target npm` in a package whose file has no `npm` key, and in one whose
 *   `launcher` is `false`, fails with code 2 and the pinned sentence, and writes nothing under
 *   `<out>`.
 * - The options. `--application`, `--build development`, `--watch`, `--facts`, and `--define` with
 *   `--target npm` each fail with code 2 and the reason, before the build reads the package.
 * - The names. A package with no `name` fails with exit 1 and names the field. A `name` outside
 *   npm's package name rule, such as `..`, `.`, `@acme/..`, or one with a capital letter, fails
 *   with code 2 before anything compiles, and every file around the package stays as it was, the
 *   parent of the output directory included.
 * - Other targets (proof 3). In a package that turns the mode on, `--target node` writes its
 *   bundle and no `npm` directory, and a compile target's facts read as they do in a package with
 *   no `npm` key.
 * - The output directory. An `--out` that is the package directory or holds it fails with code 2
 *   before anything compiles, and the package's files stay as they were.
 * - What the build writes, with every compile stubbed. A compile that fails leaves the earlier
 *   packages byte for byte as they were. The launcher package moves into place last, so a move cut
 *   short leaves the earlier launcher beside the platform packages already replaced, a mismatched
 *   set whose launcher refuses those platforms until the next build. A dropped platform's
 *   directory is removed, and a file or a link of that name, and every other entry, stays.
 * - Ownership. The build replaces or removes a package's folder only when it is a directory whose
 *   `package.json` names the package the build writes there. In a shared `--out`, a folder at a
 *   name the build writes that it does not own, such as one that holds `draft.txt`, fails the build
 *   with exit 1 before anything compiles and changes nothing, and one at a dropped platform's name
 *   stays as it is.
 */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vite-plus/test';

import {
  applicationNeedsBundle,
  noNameField,
  npmApplicationNameInvalid,
  npmDoesNotWatch,
  npmFactsPerPlatform,
  npmIsDistributed,
  npmFolderNotOwned,
  npmModeOff,
  npmOutOverlap,
  npmPackageNameInvalid,
} from '../src/commands/build/messages.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';
import { fixturePackage, linkInstalled, loom } from './package.js';
import type { BunStandIn } from './run.js';

// Ceil the toolchain's walks up from a fixture at the sandbox (see ./ceiling.ts).
vi.mock(import('node:fs'), async (importOriginal) => {
  const { ceiled } = await import('./ceiling.js');
  return ceiled(await importOriginal());
});

afterEach(() => {
  removeRoots();
});

/** How long a case that bundles with Bun may take. */
const slow = 120_000;

const application = `import { Application } from '@loomcli/core';

export const probe = new Application('probe', { description: 'Probe the npm target.' }).action(
  ({ out }) => out.print('ran'),
);
`;

const entrySource = `import { probe } from './application.js';

await probe.run();
`;

/** A probe package with the supplied configuration file, or none, and manifest fields. */
function npmPackage(config: unknown, manifest: Record<string, unknown> = {}) {
  return fixturePackage({
    'package.json': `${JSON.stringify({
      bin: { probe: 'dist/main.js' },
      name: '@acme/probe',
      repository: 'acme/probe',
      type: 'module',
      version: '1.2.3',
      ...manifest,
    })}\n`,
    'src/application.ts': application,
    'src/main.ts': entrySource,
    ...(config === undefined ? {} : { 'loom.config.json': `${JSON.stringify(config)}\n` }),
  });
}

test.each([
  { platforms: [], problem: 'Invalid length: Expected >=1 but received 0' },
  { platforms: ['linux-riscv64'], problem: 'Invalid type: Expected' },
  { platforms: ['linux-x64', 'linux-x64'], problem: 'Expected each platform once' },
])('npm.platforms $platforms fails the run with code 2', async ({ platforms, problem }) => {
  const root = npmPackage({ npm: { launcher: true, platforms } });
  const result = await loom(root, ['build', '--target', 'npm']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('npm.platforms');
  expect(result.stderr).toContain(problem);
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test('npm.platforms without launcher: true fails every build with code 2, a bundle included', async () => {
  for (const npm of [{ platforms: ['linux-x64'] }, { launcher: false, platforms: ['linux-x64'] }]) {
    const root = npmPackage({ npm });
    const result = await loom(root, ['build', '--target', 'node']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      'npm.platforms in loom.config.json: Expected npm.launcher to be true beside npm.platforms',
    );
    expect(existsSync(join(root, 'dist'))).toBe(false);
  }
});

test.each([
  { config: undefined, label: 'no configuration file' },
  { config: { paths: { out: 'build' } }, label: 'a file with no npm key' },
  { config: { npm: { launcher: false } }, label: 'launcher false' },
  { config: { npm: {} }, label: 'an npm key without launcher' },
])(
  '--target npm in a package with $label fails with code 2 and writes nothing',
  async ({ config }) => {
    const root = npmPackage(config);
    const result = await loom(root, ['build', '--target', 'npm']);
    expect(result).toEqual({
      status: 2,
      stderr: `loom: ${npmModeOff}\nRun "loom build --help" to see the usage.\n`,
      stdout: '',
    });
    expect(readdirSync(root).toSorted()).toEqual(
      ['loom.config.json', 'node_modules', 'package.json', 'src'].filter(
        (entry) => config !== undefined || entry !== 'loom.config.json',
      ),
    );
  },
);

test.each([
  {
    args: ['--application', 'src/application.ts'],
    option: 'application',
    reason: applicationNeedsBundle,
  },
  { args: ['--build', 'development'], option: 'build', reason: npmIsDistributed },
  { args: ['--watch'], option: 'watch', reason: npmDoesNotWatch },
  { args: ['--facts'], option: 'facts', reason: npmFactsPerPlatform('facts') },
  { args: ['--define'], option: 'define', reason: npmFactsPerPlatform('define') },
])(
  '--$option with --target npm fails with code 2 and the reason',
  async ({ args, option, reason }) => {
    const root = npmPackage({ npm: { launcher: true } });
    const result = await loom(root, ['build', '--target', 'npm', ...args]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.split('\n')[0]).toBe(`loom: Option "--${option}": ${reason}`);
    expect(existsSync(join(root, 'dist'))).toBe(false);
  },
);

test('a package with no name fails --target npm with exit 1 and names the field', async () => {
  const root = npmPackage({ npm: { launcher: true } }, { name: undefined });
  const result = await loom(root, ['build', '--target', 'npm']);
  expect(result).toEqual({ status: 1, stderr: `${noNameField}\n`, stdout: '' });
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test(
  'a package that turns the mode on builds --target node and reads compile facts as before',
  async () => {
    const root = npmPackage({ npm: { launcher: true, platforms: ['linux-x64'] } });
    const plain = npmPackage(undefined);
    for (const target of ['bun-linux-x64', 'bun-darwin-arm64', 'bun-linux-arm64-musl']) {
      const args = ['build', '--target', target, '--release', '--facts'];
      const [on, off] = await Promise.all([loom(root, args), loom(plain, args)]);
      expect(on).toEqual(off);
      expect(on.status).toBe(0);
    }
    const bundle = await loom(root, ['build', '--target', 'node']);
    expect(bundle.stderr).toBe('');
    expect(bundle.status).toBe(0);
    expect(readdirSync(join(root, 'dist'))).toContain('main.js');
    expect(readdirSync(join(root, 'dist'))).not.toContain('npm');
  },
  slow,
);

/** The files of a probe package, which `npmPackage` writes, under a directory of the caller's. */
function probeFiles(platforms?: string[], version = '1.2.3'): Record<string, string> {
  return {
    'loom.config.json': `${JSON.stringify({ npm: { launcher: true, ...(platforms === undefined ? {} : { platforms }) } })}\n`,
    'package.json': `${JSON.stringify({
      bin: { probe: 'dist/main.js' },
      name: '@acme/probe',
      repository: 'acme/probe',
      type: 'module',
      version,
    })}\n`,
    'src/application.ts': application,
    'src/main.ts': entrySource,
  };
}

/**
 * Writes a tagged stub for every compile, so no case compiles a binary, and fails the compile whose
 * target is `failOn`. Every other Bun call runs the real Bun.
 */
function stubCompiles(tag: string, failOn?: string): BunStandIn {
  return (call, real) => {
    const target = call.args[call.args.indexOf('--target') + 1];
    if (!call.args.includes('--compile')) {
      return real(call);
    }
    if (target === failOn) {
      return { code: 1, stderr: 'compile failed', stdout: '' };
    }
    writeFileSync(call.args[call.args.indexOf('--outfile') + 1] ?? '', `${tag} ${target ?? ''}\n`);
    return { code: 0 };
  };
}

/** Every file under a directory with its digest, by its path relative to it. */
function digests(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
      return `${path.slice(directory.length + 1)} ${digest}`;
    })
    .toSorted();
}

test.each([
  { link: undefined, out: '..', relation: 'holds' },
  { link: undefined, out: '.', relation: 'is' },
  { link: undefined, out: '../..', relation: 'holds' },
  /*
   * A link beside the package directory's parent resolves to that parent, which holds the
   * package, so only the comparison of real paths refuses it. The link sits outside the package,
   * so a recursive scan that follows links, as Bun's does, meets no cycle.
   */
  { link: 'parent', out: '../../to-parent', relation: 'holds' },
])(
  '--out $out, which $relation the package directory, fails with code 2 and writes nothing',
  async ({ link, out, relation }) => {
    // The package directory is named for the launcher's directory, so `--out ..` would replace it.
    const sandbox = temporaryRoot('loom-npm-overlap-');
    const root = join(sandbox, 'parent', 'probe');
    for (const [path, body] of Object.entries(probeFiles(['linux-x64']))) {
      put(root, path, body);
    }
    linkInstalled(root, ['core']);
    if (link !== undefined) {
      symlinkSync(link, join(sandbox, 'to-parent'));
    }
    const before = digests(sandbox);
    const result = await loom(root, ['build', '--target', 'npm', '--out', out], {
      bun: stubCompiles('v1'),
    });
    expect(result).toEqual({
      status: 2,
      stderr: `loom: ${npmOutOverlap(out, relation, '.')}\nRun "loom build --help" to see the usage.\n`,
      stdout: '',
    });
    expect(digests(sandbox)).toEqual(before);
    expect(readdirSync(join(sandbox, 'parent'))).toEqual(['probe']);
  },
  slow,
);

test(
  'a compile that fails leaves the earlier packages byte for byte as they were',
  async () => {
    const root = fixturePackage(probeFiles());
    await expect(
      loom(root, ['build', '--target', 'npm'], { bun: stubCompiles('v1') }),
    ).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'Built dist/npm for npm.\n',
    });
    const npm = join(root, 'dist/npm');
    const before = digests(npm);
    // The fourth of six platforms fails, so three compiled before it and two would after it.
    const second = await loom(root, ['build', '--target', 'npm'], {
      bun: stubCompiles('v2', 'bun-linux-x64'),
    });
    expect(second.status).toBe(1);
    expect(second.stdout).toBe('');
    expect(digests(npm)).toEqual(before);
    expect(readdirSync(npm).filter((name) => name.startsWith('.'))).toEqual([]);
  },
  slow,
);

test(
  'the launcher package moves into place last, so a move cut short leaves the earlier launcher',
  async () => {
    const root = fixturePackage(probeFiles(['linux-x64', 'linux-x64-musl']));
    const first = await loom(root, ['build', '--target', 'npm'], { bun: stubCompiles('v1') });
    expect(first.status).toBe(0);
    const npm = join(root, 'dist/npm');
    const launcher = readFileSync(join(npm, 'probe/package.json'), 'utf8');
    // A folder the build cannot empty makes the replacement of the second platform package fail.
    put(npm, 'probe-linux-x64-musl/locked/file', 'kept\n');
    chmodSync(join(npm, 'probe-linux-x64-musl/locked'), 0o555);
    put(root, 'package.json', probeFiles(undefined, '2.0.0')['package.json'] ?? '');
    try {
      const second = await loom(root, ['build', '--target', 'npm'], { bun: stubCompiles('v2') });
      expect(second.status).toBe(1);
    } finally {
      chmodSync(join(npm, 'probe-linux-x64-musl/locked'), 0o755);
    }
    // The first platform package moved, the second did not, and the launcher stayed as it was.
    expect(readFileSync(join(npm, 'probe-linux-x64/bin/probe'), 'utf8')).toBe('v2 bun-linux-x64\n');
    expect(readFileSync(join(npm, 'probe/package.json'), 'utf8')).toBe(launcher);
    // Platform folders keep their names across builds, so the set is mismatched until the next build.
    // The old launcher pins 1.2.3, and the replaced linux-x64 package is 2.0.0.
    // The launcher's version check fails that platform with the missing-package step.
    expect(JSON.parse(launcher)).toMatchObject({
      optionalDependencies: { '@acme/probe-linux-x64': '1.2.3' },
      version: '1.2.3',
    });
    expect(
      JSON.parse(readFileSync(join(npm, 'probe-linux-x64/package.json'), 'utf8')),
    ).toMatchObject({ name: '@acme/probe-linux-x64', version: '2.0.0' });
  },
  slow,
);

test(
  "a dropped platform's directory is removed, and a file or a link of that name stays",
  async () => {
    const root = fixturePackage(probeFiles());
    const first = await loom(root, ['build', '--target', 'npm'], { bun: stubCompiles('v1') });
    expect(first.status).toBe(0);
    const npm = join(root, 'dist/npm');
    const elsewhere = temporaryRoot('loom-npm-elsewhere-');
    put(elsewhere, 'kept', 'kept\n');
    // The first build wrote every platform, and linux-arm64 stays its directory.
    // A file takes linux-arm64-musl's place, and a link to a directory outside the output darwin-x64's.
    const file = join(npm, 'probe-linux-arm64-musl');
    const link = join(npm, 'probe-darwin-x64');
    rmSync(file, { recursive: true });
    writeFileSync(file, 'kept\n');
    rmSync(link, { recursive: true });
    symlinkSync(elsewhere, link, 'dir');
    for (const folder of ['probe-docs', 'probe-linux-x64-baseline', 'other']) {
      put(npm, `${folder}/kept`, 'kept\n');
    }
    put(root, 'loom.config.json', probeFiles(['linux-x64'])['loom.config.json'] ?? '');
    const second = await loom(root, ['build', '--target', 'npm'], { bun: stubCompiles('v2') });
    expect(second).toMatchObject({ status: 0, stderr: '' });
    expect(existsSync(join(npm, 'probe-linux-arm64'))).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('kept\n');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readdirSync(elsewhere)).toEqual(['kept']);
    expect(readdirSync(npm).toSorted()).toEqual(
      [
        'other',
        'probe',
        'probe-darwin-x64',
        'probe-docs',
        'probe-linux-arm64-musl',
        'probe-linux-x64',
        'probe-linux-x64-baseline',
      ].toSorted(),
    );
  },
  slow,
);

test.each(['..', '.', '@acme/..', '@acme/Probe'])(
  'a package named %s fails --target npm with code 2 before it compiles, and changes nothing',
  async (name) => {
    const sandbox = temporaryRoot('loom-npm-name-');
    const root = join(sandbox, 'probe');
    for (const [path, body] of Object.entries(probeFiles(['linux-x64']))) {
      put(root, path, body);
    }
    put(
      root,
      'package.json',
      `${JSON.stringify({ ...JSON.parse(probeFiles()['package.json'] ?? '{}'), name })}\n`,
    );
    put(root, 'dist/main.js', 'kept\n');
    linkInstalled(root, ['core']);
    const before = digests(sandbox);
    let compiles = 0;
    const result = await loom(root, ['build', '--target', 'npm'], {
      bun: (call, real) => {
        compiles += call.args.includes('--compile') ? 1 : 0;
        return stubCompiles('v1')(call, real);
      },
    });
    expect(result).toEqual({
      status: 2,
      stderr: `loom: ${npmPackageNameInvalid(name)}\nRun "loom build --help" to see the usage.\n`,
      stdout: '',
    });
    expect(compiles).toBe(0);
    expect(digests(sandbox)).toEqual(before);
  },
  slow,
);

test.each([
  { args: ['--name', '../package.json'], bin: undefined, name: '../package.json' },
  { args: ['--name', 'a/b'], bin: undefined, name: 'a/b' },
  { args: ['--name', '..'], bin: undefined, name: '..' },
  { args: [], bin: { 'x/y': 'dist/main.js' }, name: 'x/y' },
])(
  'an application name of $name fails --target npm with code 2 before it compiles, and changes nothing',
  async ({ args, bin, name }) => {
    const sandbox = temporaryRoot('loom-npm-appname-');
    const root = join(sandbox, 'probe');
    for (const [path, body] of Object.entries(probeFiles(['linux-x64']))) {
      put(root, path, body);
    }
    if (bin !== undefined) {
      put(
        root,
        'package.json',
        `${JSON.stringify({ ...JSON.parse(probeFiles()['package.json'] ?? '{}'), bin })}\n`,
      );
    }
    linkInstalled(root, ['core']);
    const before = digests(sandbox);
    let compiles = 0;
    const result = await loom(root, ['build', '--target', 'npm', ...args], {
      bun: (call, real) => {
        compiles += call.args.includes('--compile') ? 1 : 0;
        return stubCompiles('v1')(call, real);
      },
    });
    expect(result).toEqual({
      status: 2,
      stderr: `loom: ${npmApplicationNameInvalid(name)}\nRun "loom build --help" to see the usage.\n`,
      stdout: '',
    });
    expect(compiles).toBe(0);
    expect(digests(sandbox)).toEqual(before);
  },
  slow,
);

test(
  'a valid --name still builds --target npm and names the binary for it',
  async () => {
    const root = fixturePackage(probeFiles(['linux-x64']));
    const result = await loom(root, ['build', '--target', 'npm', '--name', 'tool'], {
      bun: stubCompiles('v1'),
    });
    expect(result).toEqual({ status: 0, stderr: '', stdout: 'Built dist/npm for npm.\n' });
    expect(readFileSync(join(root, 'dist/npm/probe-linux-x64/bin/tool'), 'utf8')).toBe(
      'v1 bun-linux-x64\n',
    );
  },
  slow,
);

/** A probe package beside a shared output directory, `../shared`, that holds the supplied files. */
function sharedOutput(shared: Record<string, string>, platforms: string[]) {
  const sandbox = temporaryRoot('loom-npm-shared-');
  const root = join(sandbox, 'probe');
  for (const [path, body] of Object.entries(probeFiles(platforms))) {
    put(root, path, body);
  }
  linkInstalled(root, ['core']);
  for (const [path, body] of Object.entries(shared)) {
    put(join(sandbox, 'shared'), path, body);
  }
  return { root, sandbox, shared: join(sandbox, 'shared') };
}

/** A package.json that names a package, as a folder the build wrote holds one. */
function named(name: string): string {
  return `${JSON.stringify({ name, version: '1.0.0' })}\n`;
}

test.each([
  {
    files: { 'probe-linux-x64/draft.txt': 'draft\n' },
    folder: 'probe-linux-x64',
    pkg: '@acme/probe-linux-x64',
  },
  { files: { 'probe/package.json': named('@other/probe') }, folder: 'probe', pkg: '@acme/probe' },
  {
    files: { 'probe-linux-x64/package.json': named('@acme/probe') },
    folder: 'probe-linux-x64',
    pkg: '@acme/probe-linux-x64',
  },
  {
    files: { 'probe-linux-x64': 'a file\n' },
    folder: 'probe-linux-x64',
    pkg: '@acme/probe-linux-x64',
  },
])(
  'a folder at $folder that the build did not write fails it with exit 1 before it compiles, and changes nothing',
  async ({ files, folder, pkg }) => {
    const { root, sandbox } = sharedOutput(files, ['linux-x64']);
    const before = digests(sandbox);
    let compiles = 0;
    const result = await loom(root, ['build', '--target', 'npm', '--out', '../shared'], {
      bun: (call, real) => {
        compiles += call.args.includes('--compile') ? 1 : 0;
        return stubCompiles('v1')(call, real);
      },
    });
    expect(result).toEqual({
      status: 1,
      stderr: `${npmFolderNotOwned(`../shared/${folder}`, pkg)}\n`,
      stdout: '',
    });
    expect(compiles).toBe(0);
    expect(digests(sandbox)).toEqual(before);
  },
  slow,
);

test(
  "a folder at a dropped platform's name that the build did not write stays, and an owned one is removed",
  async () => {
    const { root, shared } = sharedOutput(
      {
        'probe-darwin-arm64/package.json': named('@acme/probe-darwin-arm64'),
        'probe-linux-arm64/draft.txt': 'draft\n',
        'probe-linux-x64-musl/package.json': named('@other/probe-linux-x64-musl'),
      },
      ['linux-x64'],
    );
    const result = await loom(root, ['build', '--target', 'npm', '--out', '../shared'], {
      bun: stubCompiles('v1'),
    });
    expect(result).toEqual({ status: 0, stderr: '', stdout: 'Built ../shared for npm.\n' });
    expect(readdirSync(shared).toSorted()).toEqual([
      'probe',
      'probe-linux-arm64',
      'probe-linux-x64',
      'probe-linux-x64-musl',
    ]);
    expect(readFileSync(join(shared, 'probe-linux-arm64/draft.txt'), 'utf8')).toBe('draft\n');
    expect(readFileSync(join(shared, 'probe-linux-x64-musl/package.json'), 'utf8')).toBe(
      named('@other/probe-linux-x64-musl'),
    );
  },
  slow,
);

test(
  'a rebuild into a shared output replaces the folders it wrote and leaves the rest',
  async () => {
    const { root, shared } = sharedOutput({ 'notes/draft.txt': 'draft\n' }, ['linux-x64']);
    const args = ['build', '--target', 'npm', '--out', '../shared'];
    const first = await loom(root, args, { bun: stubCompiles('v1') });
    expect(first.status).toBe(0);
    const second = await loom(root, args, { bun: stubCompiles('v2') });
    expect(second).toEqual({ status: 0, stderr: '', stdout: 'Built ../shared for npm.\n' });
    expect(readFileSync(join(shared, 'probe-linux-x64/bin/probe'), 'utf8')).toBe(
      'v2 bun-linux-x64\n',
    );
    expect(readFileSync(join(shared, 'notes/draft.txt'), 'utf8')).toBe('draft\n');
  },
  slow,
);
