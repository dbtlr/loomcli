import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { number, object, string, union } from 'valibot';
import { parseAllDocuments } from 'yaml';

import { withVersion } from './manifest.js';
import { parseOrThrow } from './parse-or-throw.js';
import type { Release } from './release.js';
import { git, readRegularFileBytes, readWorkingFile } from './repository.js';
import type { Checkout } from './repository.js';
import type { RunHost } from './run-host.js';

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

const lockfile = object({ lockfileVersion: union([string(), number()]) });

const pnpmManifest = object({ bin: object({ pnpm: string() }) });

/** How long pnpm may take to prepare the lockfile before it is stopped. */
const lockfileLimit = 60_000;

/**
 * Prepares the lockfile in the staged copy at `root` with the installed pnpm, which starts through
 * the run's host. The run's cancellation and the time limit each stop pnpm, a cancelled run fails
 * with the signal's reason, and a shutdown that ends while pnpm still runs kills it.
 */
async function updateLockfile(run: RunHost, root: string) {
  const lock = join(root, 'pnpm-lock.yaml');
  if (existsSync(lock)) {
    for (const document of parseAllDocuments(readWorkingFile(root, 'pnpm-lock.yaml'))) {
      if (document.errors.length > 0) {
        throw new Error('pnpm-lock.yaml is invalid YAML.');
      }
      parseOrThrow(lockfile, document.toJS());
    }
  }
  const manifestPath = pnpmManifestPath();
  const manifestSource = readWorkingFile(dirname(manifestPath), 'package.json');
  const manifest = parseOrThrow(pnpmManifest, JSON.parse(manifestSource));
  const limit = AbortSignal.timeout(lockfileLimit);
  run.signal.throwIfAborted();
  const child = run.host.spawn(
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
    { cwd: root, signal: AbortSignal.any([run.signal, limit]) },
  );
  const removeKill = run.onShutdown(() => {
    child.kill('SIGKILL');
  });
  const exit = await child.exited.finally(removeKill);
  run.signal.throwIfAborted();
  if (exit.kind === 'unstarted') {
    throw exit.error;
  }
  if (limit.aborted) {
    throw new Error(
      `Lockfile preparation did not finish within ${lockfileLimit / 1000} seconds, so pnpm was stopped.`,
    );
  }
  if (exit.code !== 0) {
    throw new Error(`Lockfile preparation failed:\n${exit.stdout.text}${exit.stderr.text}`);
  }
  return readWorkingFile(root, 'pnpm-lock.yaml');
}

/**
 * The lockfile the release writes: the checkout's tracked files, or the files at `ref`, copied into
 * a scratch folder under the run's temporary folder with each library at the release version, and
 * prepared there by pnpm. The folder is removed once the lockfile is read, or when a shutdown ends
 * before the run has unwound.
 */
export async function prepareLockfile(
  checkout: Checkout,
  release: Pick<Release, 'libraries' | 'version'>,
  ref?: string,
) {
  const stage = mkdtempSync(join(checkout.host.tmpdir, 'loom-release-'));
  const removeStage = () => {
    rmSync(stage, { force: true, recursive: true });
  };
  const removeCleanup = checkout.onShutdown(removeStage);
  try {
    const paths = await git(
      checkout,
      ref === undefined ? ['ls-files', '-z'] : ['ls-tree', '-r', '--name-only', '-z', ref],
    );
    for (const path of paths.split('\0').filter(Boolean)) {
      mkdirSync(dirname(join(stage, path)), { recursive: true });
      writeFileSync(join(stage, path), await readRegularFileBytes(checkout, path, ref));
    }
    for (const library of release.libraries) {
      writeFileSync(join(stage, library.path), withVersion(library.source, release.version));
    }
    return await updateLockfile(checkout, stage);
  } finally {
    removeCleanup();
    removeStage();
  }
}

export { pnpmManifestPath };
