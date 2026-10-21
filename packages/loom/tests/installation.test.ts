// @module-tag docs

// Acceptance plan: see packages/plugins/tests/installed-files.test.ts.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, expect, test } from 'vite-plus/test';

import { recordInstallation } from '../../../scripts/test-installation.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';
import { execute, fixturePackage, loom, runtimes } from './package.js';

/** How long compiling the probe and bundling it may take. */
const slow = 300_000;

/** An application whose `installation` prints the installation its run reads, or `none`. */
const application = `import { Application, Command } from '@loomcli/core';

export const probe = new Application('probe', { description: 'Probe the installation.' })
  .command(
    new Command('installation', { description: 'Print the installation.' }).action(({ host, out }) => {
      const { installation } = host.release;
      return out.print(installation === undefined ? 'none' : JSON.stringify(installation));
    }),
  )
  .command(
    new Command('facts', { description: 'Print the release facts.' }).action(({ host, out }) =>
      out.print(JSON.stringify(host.release)),
    ),
  );
`;

/**
 * The entry: \`run()\` by default, \`app.invoke\` when PROBE_DOOR is \`invoke\`, and \`run()\` with a
 * release override when it is \`override\`.
 */
const entry = `#!/usr/bin/env node
import { probe } from './application.js';

const door = process.env.PROBE_DOOR;
if (door === 'invoke') {
  const outcome = await probe.invoke([process.argv[2] ?? 'installation'], {});
  process.stdout.write(outcome.output);
} else if (door === 'override') {
  const release = { asset: 'probe-test', channel: 'stable', repository: 'acme/probe', version: '1.0.0' };
  await probe.run({ host: { release: { build: 'distributed', release } } });
} else {
  await probe.run();
}
`;

/** The probe package, its compiled binary, and its Node bundle, built once for the file. */
let built = { binary: '', bundle: '', root: '' };

beforeAll(() => {
  const root = fixturePackage({
    'package.json': `${JSON.stringify({
      bin: { probe: 'dist/main.js' },
      name: '@acme/probe',
      repository: 'git+https://github.com/acme/probe.git',
      type: 'module',
      version: '1.0.0',
    })}\n`,
    'src/application.ts': application,
    'src/main.ts': entry,
  });
  for (const args of [
    ['--release', '--out', 'bin/probe'],
    ['--target', 'node', '--release', '--out', 'node-dist'],
  ]) {
    const result = loom(root, ['build', ...args]);
    if (result.status !== 0) {
      throw new Error(`loom build ${args.join(' ')} failed:\n${result.stderr}`);
    }
  }
  built = { binary: join(root, 'bin/probe'), bundle: join(root, 'node-dist/main.js'), root };
}, slow);

/** A temporary home and state directory, fresh for each test. */
let home = '';
let state = '';

beforeEach(() => {
  const root = temporaryRoot('loom-installation-');
  home = join(root, 'home');
  state = join(root, 'state');
  mkdirSync(home);
  mkdirSync(state);
});

afterAll(() => {
  removeRoots();
});

/** The record directory of the probe on this platform, under the test's home or state. */
function record(): string {
  return process.platform === 'darwin'
    ? join(home, 'Library', 'Application Support', 'probe', 'installation')
    : join(state, 'probe', 'installation');
}

/** The environment of a run: the test's home and state, and PATH for a runtime. */
function environment(): Record<string, string | undefined> {
  return { HOME: home, PATH: process.env.PATH, XDG_STATE_HOME: state };
}

/** Records `target` as the installed binary through the contract's shell recipe. */
function recordBinary(target: string): void {
  expect(recordInstallation('probe', target, environment())).toEqual({
    status: 0,
    stderr: '',
    stdout: '',
  });
}

/** Writes `install.json` with the supplied bytes, creating the record directory. */
function writeRecord(content: string): void {
  put(record(), 'install.json', content);
}

/** What one run of a file printed for `installation`, with its exit code and stderr checked. */
function printed(
  file: string,
  options: { env?: Record<string, string | undefined>; runtime?: string } = {},
): unknown {
  const result = execute(file, ['installation'], { env: environment(), ...options });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout === 'none\n' ? 'none' : JSON.parse(result.stdout);
}

/** The installation the recipe records for `path`, the binary's own digest computed here. */
function installation(path: string) {
  const digest = createHash('sha256').update(readFileSync(built.binary)).digest('hex');
  return { digest: `sha256:${digest}`, method: 'script', path };
}

/** The executable path one runtime reports for itself, resolved through symbolic links. */
function runtimePath(runtime: string): string {
  const result = spawnSync(runtime, ['-e', 'process.stdout.write(process.execPath)'], {
    encoding: 'utf8',
  });
  return realpathSync(result.stdout);
}

test('a compiled binary recorded by the recipe prints its installation', () => {
  recordBinary(built.binary);
  expect(printed(built.binary)).toEqual(installation(built.binary));
});

test('app.invoke in the recorded binary reads the same installation', () => {
  recordBinary(built.binary);
  expect(printed(built.binary, { env: { ...environment(), PROBE_DOOR: 'invoke' } })).toEqual(
    installation(built.binary),
  );
});

test('host.release holds the installation beside the release facts the binary baked', () => {
  recordBinary(built.binary);
  const result = execute(built.binary, ['facts'], { env: environment() });
  expect(result.stderr).toBe('');
  const facts = JSON.parse(result.stdout);
  expect(facts).toEqual({
    build: 'distributed',
    installation: installation(built.binary),
    release: expect.objectContaining({ repository: 'acme/probe', version: '1.0.0' }),
  });
});

test('a symbolic link to the binary reads the same installation', () => {
  recordBinary(built.binary);
  const link = join(home, 'probe-link');
  symlinkSync(built.binary, link);
  expect(printed(link)).toEqual(installation(built.binary));
});

test('a recorded path that is a symbolic link to the binary reads the installation as recorded', () => {
  const link = join(home, 'bin', 'probe');
  mkdirSync(join(home, 'bin'));
  symlinkSync(built.binary, link);
  recordBinary(link);
  expect(printed(built.binary)).toEqual(installation(link));
});

test('a copy of the binary at another path has no installation', () => {
  recordBinary(built.binary);
  const copy = join(home, 'probe-copy');
  copyFileSync(built.binary, copy);
  expect(printed(copy)).toBe('none');
});

test('install.json with an extra member and its members reordered reads the same installation', () => {
  const { digest, method, path } = installation(built.binary);
  writeRecord(`${JSON.stringify({ digest, extra: [1], format: 1, method, path })}\n`);
  expect(printed(built.binary)).toEqual(installation(built.binary));
});

test.each([
  ['empty', () => ''],
  ['not JSON', () => '{"format":1,'],
  ['an array', () => '[]\n'],
  ['format 2', () => JSON.stringify({ ...installation(built.binary), format: 2 })],
  [
    'an empty method',
    () => JSON.stringify({ ...installation(built.binary), format: 1, method: '' }),
  ],
  ['a relative path', () => JSON.stringify({ ...installation('bin/probe'), format: 1 })],
  [
    'an uppercase digest',
    () => {
      const { digest, ...rest } = installation(built.binary);
      return JSON.stringify({
        ...rest,
        digest: `sha256:${digest.slice(7).toUpperCase()}`,
        format: 1,
      });
    },
  ],
])('install.json that is %s reads no installation', (_case, content) => {
  writeRecord(content());
  expect(printed(built.binary)).toBe('none');
});

test('a missing install.json reads no installation', () => {
  expect(printed(built.binary)).toBe('none');
});

test('an install.json that is a directory reads no installation', () => {
  mkdirSync(join(record(), 'install.json'), { recursive: true });
  expect(printed(built.binary)).toBe('none');
});

test('an unset directory variable reads no installation', () => {
  recordBinary(built.binary);
  expect(printed(built.binary, { env: {} })).toBe('none');
});

test.each(runtimes)(
  'a Node bundle built with --release under %s reads no installation, even of its runtime',
  (runtime) => {
    recordBinary(runtimePath(runtime));
    expect(printed(built.bundle, { runtime })).toBe('none');
  },
);

test('the source run reads no installation, even of its runtime', () => {
  recordBinary(runtimePath('bun'));
  expect(printed(join(built.root, 'src/main.ts'), { runtime: 'bun' })).toBe('none');
});

test('a release override reads the override and no installation', () => {
  recordBinary(built.binary);
  const result = execute(built.binary, ['facts'], {
    env: { ...environment(), PROBE_DOOR: 'override' },
  });
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    build: 'distributed',
    release: { asset: 'probe-test', channel: 'stable', repository: 'acme/probe', version: '1.0.0' },
  });
});
