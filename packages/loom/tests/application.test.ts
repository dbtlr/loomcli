import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/** The built bin, started behind the hook that records each file of the bundle it loads. */
const loads = new URL('fixtures/loads.mjs', import.meta.url);

/** Bun writes the source path of each module it bundles in a comment above that module's code. */
const bundledModule = /^\/\/ (?:\.\.\/)*(?<path>src\/\S+\.ts)$/gmu;

/** The toolchain's own command modules one invocation of the built bin loads, by source path. */
function loadedCommandModules(args: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-loads-'));
  const marks = join(directory, 'marks.txt');
  try {
    const result = invoke(loads, args, { env: { LOOM_FIXTURE_MARKS: marks } });
    expect(result.status).toBe(0);
    const files = readFileSync(marks, 'utf8').split('\n').filter(Boolean);
    const modules = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(bundledModule)].flatMap(
        (found) => found.groups?.path ?? [],
      ),
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

test('the changelog help pages name notes, its version argument, and the write --target option', async () => {
  const group = await run(['changelog', '--help']);
  expect(group.stdout).toMatch(/^ {2}notes +/mu);
  const notes = await run(['changelog', 'notes', '--help']);
  expect(notes.status).toBe(0);
  expect(notes.stdout).toContain('loom changelog notes');
  expect(notes.stdout).toContain('version');
  const write = await run(['changelog', 'write', '--help']);
  expect(write.stdout).toContain('--target');
});
