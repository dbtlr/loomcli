import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as after } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';

import { start } from '../../../scripts/test-process.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';
import { cli, execute, fixturePackage, loom, runtimes, snapshot } from './package.js';

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

/** What `loom build` printed when it built nothing but the facts. */
function printed(root: string, args: string[]) {
  const result = loom(root, ['build', ...args]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

const generic = { status: 1, stderr: 'probe: Something went wrong.\n', stdout: '' };

const foreignThrow =
  /^-- UNHANDLED EXCEPTION -+ @loomcli\/core\/foreign-throw\n\nThe probe failed\.\n/u;

/** The compile target Bun names for the host this test runs on. */
function hostTarget() {
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  const report = spawnSync(
    'bun',
    ['-e', 'process.stdout.write(process.report.getReport().header.glibcVersionRuntime ?? "")'],
    { encoding: 'utf8' },
  );
  const musl = process.platform === 'linux' && report.stdout === '' ? '-musl' : '';
  return `bun-${os}-${process.arch}${musl}`;
}

test('a build outside any package fails and says to run it inside a package directory', () => {
  const root = temporaryRoot('loom-build-');
  const result = loom(root, ['build', '--target', 'node']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Run loom inside a package directory.');
});

test('--target node writes a bundle of the entry and the application module that reads distributed', () => {
  const root = probePackage();
  const result = loom(root, ['build', '--target', 'node']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const files = readdirSync(join(root, 'dist'));
  expect(files).toContain('main.js');
  expect(files).toContain('application.js');
  expect(files.filter((file) => !['application.js', 'main.js'].includes(file))).toEqual(
    expect.arrayContaining([expect.stringMatching(/^chunk-[\da-z]+\.js$/u)]),
  );
  expect(readFileSync(join(root, 'dist/main.js'), 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/u);
  for (const runtime of runtimes) {
    expect(factsOf(join(root, 'dist/main.js'), runtime)).toEqual({ build: 'distributed' });
    expect(execute(join(root, 'dist/main.js'), ['throw'], { runtime })).toEqual(generic);
  }
});

test('the built application module runs on a caller host with the facts the build baked', () => {
  const root = probePackage();
  expect(loom(root, ['build', '--target', 'node']).status).toBe(0);
  const caller = join(root, 'caller.mjs');
  writeFileSync(
    caller,
    `const { probe } = await import(${JSON.stringify(pathToFileURL(join(root, 'dist/application.js')).href)});
const outcome = await probe.invoke(['facts'], {});
process.stdout.write(outcome.output);
`,
  );
  for (const runtime of runtimes) {
    const result = execute(caller, [], { runtime });
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ build: 'distributed' });
  }
});

test('--target bun writes a bundle that reads distributed', () => {
  const root = probePackage();
  const result = loom(root, ['build', '--target', 'bun']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  for (const runtime of runtimes) {
    expect(factsOf(join(root, 'dist/main.js'), runtime)).toEqual({ build: 'distributed' });
  }
});

test('--entry builds the module it names, and with no --entry the build reads src/main.ts', () => {
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
  const named = loom(join(root, 'src'), ['build', '--target', 'node', '--entry', 'cli.ts']);
  expect(named.stderr).toBe('');
  expect(named.status).toBe(0);
  expect(existsSync(join(root, 'dist/main.js'))).toBe(false);
  expect(execute(join(root, 'dist/cli.js'), ['facts'], { runtime: 'node' }).stdout).toBe(
    'cli\n{"build":"distributed"}\n',
  );
  expect(loom(root, ['build', '--target', 'node']).status).toBe(0);
  expect(factsOf(join(root, 'dist/main.js'), 'node')).toEqual({ build: 'distributed' });
});

test('a package without src/application.ts bundles its entry alone', () => {
  const root = fixturePackage({
    'package.json': '{"name":"solo","type":"module","version":"1.0.0"}\n',
    'src/main.ts': `${application.replace('export const', 'const')}\nawait probe.run();\n`,
  });
  const result = loom(root, ['build', '--target', 'node']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(readdirSync(join(root, 'dist'))).toEqual(['main.js']);
  expect(factsOf(join(root, 'dist/main.js'), 'node')).toEqual({ build: 'distributed' });
});

test('--application bundles the module it names, and one that does not exist fails naming it', () => {
  const root = probePackage({}, { 'src/app.ts': application });
  const named = loom(root, ['build', '--target', 'node', '--application', 'src/app.ts']);
  expect(named.status).toBe(0);
  expect(readdirSync(join(root, 'dist'))).toContain('app.js');
  const missing = loom(root, ['build', '--target', 'node', '--application', 'src/gone.ts']);
  expect(missing.status).toBe(1);
  expect(missing.stdout).toBe('');
  expect(missing.stderr).toContain('src/gone.ts');
});

test(
  'the host compile target, by default, writes dist/<name>, a binary that runs with no runtime',
  () => {
    const root = probePackage({
      bin: { probe: 'dist/main.js' },
      repository: 'git+https://github.com/acme/probe.git',
    });
    const result = loom(root, ['build', '--release']);
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
        lane: 'stable',
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
  () => {
    const root = probePackage();
    const result = loom(root, ['build', '--target', hostTarget(), '--out', 'bin/named']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(factsOf(join(root, 'bin/named'))).toEqual({ build: 'distributed' });
  },
  slow,
);

test.each([
  ['browser', /browser/u],
  ['bun-plan9-x64', /bun-plan9-x64/u],
  ['deno', /deno/u],
])('--target %s exits with an error that names the targets', (target, named) => {
  const root = probePackage();
  const result = loom(root, ['build', '--target', target]);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(named);
  expect(result.stderr).toContain('node, bun, or a Bun compile target');
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test('--build development writes an artifact that reads development and shows its author a defect', () => {
  const root = probePackage();
  expect(loom(root, ['build', '--target', 'node', '--build', 'development']).status).toBe(0);
  for (const runtime of runtimes) {
    expect(factsOf(join(root, 'dist/main.js'), runtime)).toEqual({ build: 'development' });
    const failed = execute(join(root, 'dist/main.js'), ['throw'], { runtime });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(foreignThrow);
  }
});

test('--build takes development or distributed alone', () => {
  const root = probePackage();
  const result = loom(root, ['build', '--target', 'node', '--build', 'source']);
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

test('--watch with --build distributed is an option error', () => {
  const root = probePackage();
  const result = loom(root, ['build', '--watch', '--build', 'distributed', '--target', 'node']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--watch');
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test.each([
  ['1.1.0-next.3', 'next'],
  ['2.0.0', 'stable'],
])(
  '--release in a package at %s reads its version, lane %s, and repository with no asset',
  (version, lane) => {
    const root = probePackage({ repository: 'git+https://github.com/acme/probe.git', version });
    expect(loom(root, ['build', '--target', 'node', '--release']).status).toBe(0);
    for (const runtime of runtimes) {
      expect(factsOf(join(root, 'dist/main.js'), runtime)).toEqual({
        build: 'distributed',
        release: { lane, repository: 'acme/probe', version },
      });
      expect(execute(join(root, 'dist/main.js'), ['throw'], { runtime })).toEqual(generic);
    }
  },
);

test('--repository overrides the repository field', () => {
  const root = probePackage({ repository: 'git+https://github.com/acme/probe.git' });
  expect(
    loom(root, ['build', '--target', 'node', '--release', '--repository', 'other/fork']).status,
  ).toBe(0);
  expect(factsOf(join(root, 'dist/main.js'), 'node')).toEqual({
    build: 'distributed',
    release: { lane: 'stable', repository: 'other/fork', version: '1.0.0' },
  });
});

test.each([
  ['the git+https form', 'git+https://github.com/acme/probe.git'],
  ['an https address', 'https://github.com/acme/probe'],
  ['the ssh form', 'git@github.com:acme/probe.git'],
  ['the owner/name shorthand', 'acme/probe'],
  ['the github: shorthand', 'github:acme/probe'],
  ['an object with a url', { type: 'git', url: 'git+https://github.com/acme/probe.git' }],
])('--release reads the repository from %s', (_form, repository) => {
  const root = probePackage({ repository });
  expect(JSON.parse(printed(root, ['--target', 'node', '--release', '--facts']))).toEqual({
    build: 'distributed',
    release: { repository: 'acme/probe', version: '1.0.0' },
  });
});

test('--release with no repository field and no --repository exits 1 and names --repository', () => {
  const root = probePackage();
  const result = loom(root, ['build', '--target', 'node', '--release']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--repository');
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test('--release with a repository field it cannot read exits 1 and names --repository', () => {
  const root = probePackage({ repository: 'https://example.com/' });
  const result = loom(root, ['build', '--target', 'node', '--release']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('--repository');
});

test('--release with no version exits 1 and names the version field', () => {
  const root = probePackage({ repository: 'acme/probe', version: undefined });
  const result = loom(root, ['build', '--target', 'node', '--release']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('version');
  expect(result.stderr).toContain('package.json');
});

test('a compile target with no bin and no --name exits 1 and names --name', () => {
  const root = probePackage();
  const result = loom(root, ['build', '--target', 'bun-linux-x64']);
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
])('a compile target names its asset from %s', (_case, manifest, args, name) => {
  const root = probePackage({ repository: 'acme/probe', ...manifest });
  const facts = printed(root, ['--target', 'bun-linux-x64-musl', '--release', '--facts', ...args]);
  expect(JSON.parse(facts)).toEqual({
    build: 'distributed',
    release: { asset: `${name}-linux-x64-musl`, repository: 'acme/probe', version: '1.0.0' },
  });
});

test('an object bin with several keys and no --name names --name', () => {
  const root = probePackage({
    bin: { one: 'dist/one.js', two: 'dist/two.js' },
    repository: 'acme/probe',
  });
  const result = loom(root, ['build', '--target', 'bun-linux-x64', '--release', '--facts']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('--name');
});

test('a windows target names its asset with .exe', () => {
  const root = probePackage({ bin: { notes: 'dist/main.js' }, repository: 'acme/probe' });
  const facts = printed(root, ['--target', 'bun-windows-x64', '--release', '--facts']);
  expect(JSON.parse(facts)).toMatchObject({ release: { asset: 'notes-windows-x64.exe' } });
});

test('--facts and --define each print one line, write no file, and compose a build that reads the same facts', () => {
  const root = probePackage({ repository: 'acme/probe', version: '1.1.0-next.3' });
  const args = ['--target', 'node', '--release', '--build', 'development'];
  const facts = printed(root, [...args, '--facts']);
  const define = printed(root, [...args, '--define']);
  expect(existsSync(join(root, 'dist'))).toBe(false);
  expect(facts.split('\n')).toHaveLength(2);
  expect(JSON.parse(facts)).toEqual({
    build: 'development',
    release: { repository: 'acme/probe', version: '1.1.0-next.3' },
  });
  expect(define).toBe(`__LOOM_RELEASE__=${facts}`);
  const expected = {
    build: 'development',
    release: { lane: 'next', repository: 'acme/probe', version: '1.1.0-next.3' },
  };
  expect(loom(root, ['build', ...args]).status).toBe(0);
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

test('--facts and --define exclude each other', () => {
  const root = probePackage();
  const result = loom(root, ['build', '--target', 'node', '--facts', '--define']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--facts');
  expect(result.stderr).toContain('--define');
});

test('a syntax error in the entry exits 1 and leaves the earlier output byte-identical', () => {
  const root = probePackage();
  expect(loom(root, ['build', '--target', 'node']).status).toBe(0);
  put(root, 'dist/notes.txt', 'Not the build’s.\n');
  const before = snapshot(join(root, 'dist'));
  writeFileSync(join(root, 'src/main.ts'), 'const broken = ;\n');
  const result = loom(root, ['build', '--target', 'node']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('src/main.ts');
  expect(snapshot(join(root, 'dist'))).toEqual(before);
  expect(readdirSync(root).toSorted()).toEqual(['dist', 'node_modules', 'package.json', 'src']);
});

test('a rebuild replaces the files it writes and leaves every other file alone', () => {
  const root = probePackage();
  put(root, 'dist/notes.txt', 'Not the build’s.\n');
  put(root, 'dist/main.js', 'stale\n');
  expect(loom(root, ['build', '--target', 'node']).status).toBe(0);
  expect(readFileSync(join(root, 'dist/notes.txt'), 'utf8')).toBe('Not the build’s.\n');
  expect(factsOf(join(root, 'dist/main.js'), 'node')).toEqual({ build: 'distributed' });
});

test('a build with no Bun on the PATH exits 1 and names Bun', () => {
  const root = probePackage();
  const runtime = spawnSync(process.env.LOOM_TEST_RUNTIME ?? 'node', ['-p', 'process.execPath'], {
    encoding: 'utf8',
  }).stdout.trim();
  const result = loom(root, ['build', '--target', 'node'], {
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
