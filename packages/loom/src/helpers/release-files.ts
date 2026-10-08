import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAllDocuments } from 'yaml';
import { z } from 'zod';

import { withVersion } from './manifest.js';
import type { prepareRelease } from './release.js';
import { git, readRegularFile, readRegularFileBytes } from './repository.js';

/**
 * The installed pnpm manifest's path. pnpm is an optional peer dependency, because only lockfile
 * preparation runs it, so a missing one fails with a sentence instead of a resolve error.
 */
function pnpmManifestPath(
  resolve: (specifier: string) => string = (specifier) => import.meta.resolve(specifier),
) {
  try {
    return fileURLToPath(resolve('pnpm/package.json'));
  } catch (error) {
    throw new Error(
      'Preparing pnpm-lock.yaml requires pnpm, an optional peer dependency of @loomcli/loom. Install pnpm 12.8.1 beside @loomcli/loom and run the command again.',
      { cause: error },
    );
  }
}

function updateLockfile(root: string) {
  const lock = join(root, 'pnpm-lock.yaml');
  if (existsSync(lock)) {
    for (const document of parseAllDocuments(readRegularFile(root, 'pnpm-lock.yaml'))) {
      if (document.errors.length > 0) {
        throw new Error('pnpm-lock.yaml is invalid YAML.');
      }
      z.object({ lockfileVersion: z.union([z.string(), z.number()]) }).parse(document.toJS());
    }
  }
  const manifestPath = pnpmManifestPath();
  const manifestSource = readRegularFile(dirname(manifestPath), 'package.json');
  const manifest = z
    .object({ bin: z.object({ pnpm: z.string() }) })
    .parse(JSON.parse(manifestSource));
  const result = spawnSync(
    join(dirname(manifestPath), manifest.bin.pnpm),
    [
      'install',
      '--lockfile-only',
      '--lockfile-dir',
      '.',
      '--offline',
      '--ignore-scripts',
      '--ignore-pnpmfile',
      '--config.frozen-lockfile=false',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Lockfile preparation failed:\n${result.stdout}${result.stderr}`);
  }
  return readRegularFile(root, 'pnpm-lock.yaml');
}

export function prepareLockfile(
  root: string,
  release: Pick<ReturnType<typeof prepareRelease>, 'libraries' | 'version'>,
  ref?: string,
) {
  const stage = mkdtempSync(join(tmpdir(), 'loom-release-'));
  try {
    const paths = git(
      root,
      ref === undefined ? ['ls-files', '-z'] : ['ls-tree', '-r', '--name-only', '-z', ref],
    );
    for (const path of paths.split('\0').filter(Boolean)) {
      mkdirSync(dirname(join(stage, path)), { recursive: true });
      writeFileSync(join(stage, path), readRegularFileBytes(root, path, ref));
    }
    for (const library of release.libraries) {
      writeFileSync(join(stage, library.path), withVersion(library.source, release.version));
    }
    return updateLockfile(stage);
  } finally {
    rmSync(stage, { force: true, recursive: true });
  }
}

export { pnpmManifestPath };
