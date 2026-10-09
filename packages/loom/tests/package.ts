import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { childEnvironment } from '../../../scripts/test-process.js';
import { put, temporaryRoot } from './fixture.js';

/** The repository root, whose installed packages a fixture package links. */
const repository = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The installed packages a fixture package can link into its own `node_modules`, each the real
 * directory the repository installed, so the fixture resolves them as an installed package would.
 */
const installed = {
  core: { from: 'packages/core', to: '@loomcli/core' },
  types: { from: 'packages/core/node_modules/@types/node', to: '@types/node' },
  typescript: { from: 'node_modules/typescript', to: 'typescript' },
} as const;

/** How long one loom run may take, which a compile or a type pass stretches. */
const loomTimeout = 120_000;

/** The built loom bin every process test runs. */
export const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url));

/** The runtimes every artifact runs under. */
export const runtimes = ['node', 'bun'] as const;

/** A link a fixture package holds: core, the TypeScript compiler, or Node's type declarations. */
export type Link = keyof typeof installed;

/**
 * A package directory in a temporary root that holds the supplied files and links the supplied
 * installed packages, by default core alone. `removeRoots()` deletes it when the test ends.
 */
export function fixturePackage(
  files: Record<string, string>,
  links: readonly Link[] = ['core'],
): string {
  const root = temporaryRoot('loom-package-');
  for (const [path, body] of Object.entries(files)) {
    put(root, path, body);
  }
  linkInstalled(root, links);
  return root;
}

/**
 * Links the supplied installed packages into an existing package directory's `node_modules`, as a
 * package manager's install would.
 */
export function linkInstalled(root: string, links: readonly Link[]) {
  for (const link of links) {
    const { from, to } = installed[link];
    const target = join(root, 'node_modules', to);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(realpathSync(join(repository, from)), target, 'dir');
  }
}

/** One run of the loom bin under the runtime the test run names, with a generous timeout. */
export function loom(
  cwd: string,
  args: string[],
  options: { env?: Record<string, string | undefined>; runtime?: string } = {},
) {
  const result = spawnSync(
    options.runtime ?? process.env.LOOM_TEST_RUNTIME ?? 'node',
    [cli, ...args],
    {
      cwd,
      encoding: 'utf8',
      env: childEnvironment(options.env),
      timeout: loomTimeout,
    },
  );
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/** One run of a built artifact, under a runtime or as a binary when the runtime is undefined. */
export function execute(
  file: string,
  args: string[],
  options: { env?: Record<string, string | undefined>; runtime?: string } = {},
) {
  const command = options.runtime === undefined ? file : options.runtime;
  const commandArgs = options.runtime === undefined ? args : [file, ...args];
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    env: options.env ?? childEnvironment(undefined),
    timeout: loomTimeout,
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/** Every file under a directory, by relative path, so a test can prove a build changed nothing. */
export function snapshot(directory: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      files.set(relative(directory, path), readFileSync(path).toString('base64'));
    }
  }
  return files;
}
