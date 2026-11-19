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

/**
 * Derives the Homebrew or global npm installation for an application's absolute realpath.
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
  const directories = path.slice(parse(path).root.length).split(sep).slice(0, -1);
  const kegDirectories = 2;
  const cellar = directories.slice(0, -kegDirectories).lastIndexOf('Cellar');
  const formula = cellar === -1 ? undefined : directories[cellar + 1];
  if (formula !== undefined) {
    return Object.freeze({ formula, method: 'brew', path });
  }
  const modules = directories.indexOf('node_modules');
  return modules > 0 && directories[modules - 1] === 'lib'
    ? Object.freeze({ method: 'npm', path })
    : undefined;
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
export { packageManagerInstallation, readInstallation };
