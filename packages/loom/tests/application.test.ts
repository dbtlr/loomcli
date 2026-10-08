import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';
import { loom } from '../src/application.js';
import { pnpmManifestPath } from '../src/helpers/release-files.js';

test('the changelog is public while the release commands stay hidden', () => {
  const children = loom.inspect().root.children.map(({ hidden, name }) => ({ hidden, name }));
  expect(children).toEqual([
    { hidden: false, name: 'changelog' },
    { hidden: true, name: 'pr' },
    { hidden: true, name: 'release' },
  ]);
});

const cli = new URL('../dist/main.js', import.meta.url);

test('--help lists the changelog and advertises no release command', () => {
  const result = invoke(cli, ['--help']);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/^ {2}changelog +/mu);
  expect(result.stdout).not.toMatch(/^ {2}(?:pr|release) +/mu);
});

test('--help prints the help page of the routed release Command', () => {
  const result = invoke(cli, ['release', 'plan', '--help']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('loom release plan');
  expect(result.stderr).toBe('');
});

test('--version prints the version of the @loomcli/loom package', () => {
  const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const { version } = z.object({ version: z.string() }).parse(JSON.parse(manifest));
  const result = invoke(cli, ['--version']);
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
