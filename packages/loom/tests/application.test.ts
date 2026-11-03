import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';
import { loom } from '../src/application.js';
import { pnpmManifestPath } from '../src/helpers/release-files.js';
import { removeRoots } from './fixture.js';
import { run } from './run.js';

afterEach(removeRoots);

test('build, init, and the changelog are public while the release commands stay hidden', () => {
  const children = loom.inspect().root.children.map(({ hidden, name }) => ({ hidden, name }));
  expect(children).toEqual([
    { hidden: false, name: 'build' },
    { hidden: false, name: 'changelog' },
    { hidden: false, name: 'init' },
    { hidden: true, name: 'pr' },
    { hidden: true, name: 'release' },
  ]);
});

test('--help lists build, init, and the changelog and advertises no release command', async () => {
  const result = await run(['--help']);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/^ {2}build +/mu);
  expect(result.stdout).toMatch(/^ {2}changelog +/mu);
  expect(result.stdout).not.toMatch(/^ {2}check +/mu);
  expect(result.stdout).toMatch(/^ {2}init +/mu);
  expect(result.stdout).not.toMatch(/^ {2}(?:pr|release) +/mu);
});

test('--help prints the help page of the routed release Command', async () => {
  const result = await run(['release', 'plan', '--help']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('loom release plan');
  expect(result.stderr).toBe('');
});

/** A bin, started behind the hook that records each file of the bundle it loads. */
const loads = new URL('fixtures/loads.mjs', import.meta.url);

/** The toolchain's package directory, which a build of the bin runs in. */
const toolchain = fileURLToPath(new URL('..', import.meta.url));

/**
 * In a development build, Bun writes the path of each module it bundles in a comment above that
 * module's code, relative to the output directory. A distributed build minifies the comments away,
 * but splits its chunks the same.
 */
const bundledModule = /^\/\/ (?<path>\S+\.ts)$/gmu;

/** Builds a development copy of the bin from source into `directory`, and returns its entry. */
function developmentBin(directory: string): string {
  const out = join(directory, 'dist');
  const built = spawnSync(
    'bun',
    ['src/main.ts', 'build', '--target', 'node', '--build', 'development', '--out', out],
    { cwd: toolchain, encoding: 'utf8' },
  );
  expect(built.stderr).toBe('');
  expect(built.status).toBe(0);
  return join(out, 'main.js');
}

/** The toolchain's own command modules one invocation of a development bin loads, by source path. */
function loadedCommandModules(args: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-loads-'));
  const marks = join(directory, 'marks.txt');
  try {
    const bin = developmentBin(directory);
    const result = invoke(loads, args, {
      env: { LOOM_FIXTURE_BIN: bin, LOOM_FIXTURE_MARKS: marks },
    });
    expect(result.status).toBe(0);
    const files = readFileSync(marks, 'utf8').split('\n').filter(Boolean);
    const modules = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(bundledModule)].flatMap((found) => {
        const path = found.groups?.path;
        return path === undefined ? [] : relative(toolchain, resolve(dirname(file), path));
      }),
    );
    return [...new Set(modules)]
      .filter((path) => path.startsWith('src/commands/'))
      .toSorted((left, right) => left.localeCompare(right));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test('--help loads every command declaration and the work of no command', () => {
  expect(loadedCommandModules(['--help'])).toEqual([
    'src/commands/build/command.ts',
    'src/commands/changelog/command.ts',
    'src/commands/init/command.ts',
    'src/commands/pr/command.ts',
    'src/commands/release/command.ts',
  ]);
});

test("changelog check loads its own work and no other command's", () => {
  const modules = loadedCommandModules(['changelog', 'check']);
  expect(modules.filter((path) => !path.endsWith('/command.ts'))).toEqual([
    'src/commands/changelog/check.ts',
  ]);
});

test('--version prints the version of the @loomcli/loom package', async () => {
  const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const { version } = z.object({ version: z.string() }).parse(JSON.parse(manifest));
  const result = await run(['--version']);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(`loom v${version}\n`);
});

test('a missing pnpm fails lockfile preparation with a sentence that says how to install it', () => {
  const missing = Object.assign(new Error("Cannot find package 'pnpm'"), {
    code: 'ERR_MODULE_NOT_FOUND',
  });
  expect(() =>
    pnpmManifestPath(() => {
      throw missing;
    }),
  ).toThrow(
    new Error(
      'Preparing pnpm-lock.yaml requires pnpm, an optional peer dependency of @loomcli/loom. Install pnpm 12.8.1 beside @loomcli/loom and run the command again.',
    ),
  );
});

test('an installed pnpm resolves to its manifest path', () => {
  expect(pnpmManifestPath(() => 'file:///workspace/node_modules/pnpm/package.json')).toBe(
    '/workspace/node_modules/pnpm/package.json',
  );
});
