import { realpathSync } from 'node:fs';
import { isAbsolute, join, parse, sep } from 'node:path';

import type { Host } from '../host/types.js';
import { readSmallFile } from '../support/files.js';
import { isPlainObject } from '../support/plain.js';
import { applicationDirectory } from './directory.js';
import type { ReleaseFacts } from './types.js';

/** How the running application was installed. */
type Installation = NonNullable<ReleaseFacts['installation']>;

/** The application and host facts that find its installation record. */
interface InstallationLookup {
  readonly application: string;
  readonly env: Host['env'];
  readonly home: string;
  readonly platform: string;
}

/** A SHA-256 digest as the record spells it: `sha256:` and 64 lowercase hexadecimal digits. */
const sha256Digest = /^sha256:[\da-f]{64}$/u;

/** The installation one parsed `install.json` holds, or `undefined` when it is not that object. */
function installationOf(value: unknown): Installation | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const { digest, format, method, path } = value;
  const known =
    format === 1 &&
    typeof method === 'string' &&
    method !== '' &&
    typeof path === 'string' &&
    isAbsolute(path) &&
    typeof digest === 'string' &&
    sha256Digest.test(digest);
  return known ? Object.freeze({ digest, method, path }) : undefined;
}

/** The record's installation when its path resolves to the running executable. */
function recordedInstallation(lookup: InstallationLookup, path: string): Installation | undefined {
  const directory = applicationDirectory('installation', lookup.application, lookup);
  if (!('path' in directory)) {
    return undefined;
  }
  try {
    const text = readSmallFile(join(directory.path, 'install.json'));
    const installation = text === undefined ? undefined : installationOf(JSON.parse(text));
    return installation !== undefined && realpathSync(installation.path) === path
      ? installation
      : undefined;
  } catch {
    return undefined;
  }
}

/** A test of one directory component: its whole name, or a pattern the whole name matches. */
type ComponentTest = string | RegExp;

/** One package manager's global root: the last components before the outermost `node_modules`. */
interface GlobalRoot {
  readonly method: 'bun' | 'npm' | 'pnpm' | 'yarn';
  readonly tail: readonly ComponentTest[];
}

/** A version folder of all digits. */
const allDigits = /^\d+$/u;

/** A store folder named `v` and digits. */
const vAndDigits = /^v\d+$/u;

/** Any one folder, such as a package folder or a hash. */
const anyFolder = /^/u;

/**
 * ADR-0211's global roots, row for row. Each tail lists, in order, the last components before the
 * outermost `node_modules`, ending just before it. No real layout matches two rows.
 */
const globalRoots: readonly GlobalRoot[] = [
  { method: 'npm', tail: ['lib'] },
  { method: 'pnpm', tail: ['global', allDigits, '.pnpm', anyFolder] },
  { method: 'pnpm', tail: [vAndDigits, 'links', anyFolder, anyFolder, anyFolder, anyFolder] },
  { method: 'bun', tail: ['install', 'global'] },
  { method: 'yarn', tail: ['yarn', 'global'] },
];

function passes(test: ComponentTest, component: string | undefined): boolean {
  if (component === undefined) {
    return false;
  }
  return typeof test === 'string' ? component === test : test.test(component);
}

/** The directory components of an absolute path, without its root and its file name. */
function directoriesOf(path: string): string[] {
  return path.slice(parse(path).root.length).split(sep).slice(0, -1);
}

/** Every global root whose tail ends just before the outermost `node_modules` of the directories. */
function matchingRoots(directories: readonly string[]): readonly GlobalRoot[] {
  const modules = directories.indexOf('node_modules');
  const before = modules === -1 ? [] : directories.slice(0, modules);
  return globalRoots.filter(({ tail }) => {
    const ending = before.slice(-tail.length);
    return (
      ending.length === tail.length && tail.every((test, index) => passes(test, ending[index]))
    );
  });
}

/**
 * Derives the Homebrew, npm, pnpm, Bun, or Yarn installation for an application's absolute realpath.
 * Returns `undefined` for other layouts or on Windows. Reads no installation record.
 *
 * @example
 * ```ts
 * import { realpathSync } from 'node:fs';
 * import { packageManagerInstallation } from '@loomcli/core';
 *
 * const installation = packageManagerInstallation(realpathSync(process.execPath), process.platform);
 * ```
 *
 * @public
 */
function packageManagerInstallation(path: string, platform: string): ReleaseFacts['installation'] {
  if (platform === 'win32') {
    return undefined;
  }
  const directories = directoriesOf(path);
  const kegDirectories = 2;
  const cellar = directories.slice(0, -kegDirectories).lastIndexOf('Cellar');
  const formula = cellar === -1 ? undefined : directories[cellar + 1];
  if (formula !== undefined) {
    return Object.freeze({ formula, method: 'brew', path });
  }
  const [root] = matchingRoots(directories);
  return root === undefined ? undefined : Object.freeze({ method: root.method, path });
}

/** Resolves the application path and prefers a matching record over its directory layout. */
function readInstallation(
  lookup: InstallationLookup,
  applicationPath: string | undefined,
  hasAsset: boolean,
): Installation | undefined {
  if (applicationPath === undefined || applicationPath === '') {
    return undefined;
  }
  try {
    const path = realpathSync(applicationPath);
    const recorded = hasAsset ? recordedInstallation(lookup, path) : undefined;
    return recorded ?? packageManagerInstallation(path, lookup.platform);
  } catch {
    return undefined;
  }
}

export type { InstallationLookup };
export { directoriesOf, matchingRoots, packageManagerInstallation, readInstallation };
