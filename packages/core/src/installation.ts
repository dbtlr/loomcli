import { realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { applicationDirectory } from './directory.js';
import { readSmallFile } from './files.js';
import { isPlainObject } from './plain.js';
import type { Host, ReleaseFacts } from './types.js';

/** How the running application was installed, as its installation record holds it. */
type Installation = NonNullable<ReleaseFacts['installation']>;

/**
 * What finds a run's installation record: the application's name and the run's env, home, and
 * platform, and the path of the running executable the record must name.
 */
interface InstallationLookup {
  readonly application: string;
  readonly env: Host['env'];
  readonly executable: string;
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

/**
 * The installation the record's `install.json` holds, trusted only when its path and the running
 * executable resolve through symbolic links to the same path. A variable the directory needs, a
 * missing or unreadable file, malformed content, and another path each answer `undefined`, and
 * nothing is reported. It never hashes the binary.
 */
function readInstallation(lookup: InstallationLookup): Installation | undefined {
  const directory = applicationDirectory('installation', lookup.application, lookup);
  if (!('path' in directory)) {
    return undefined;
  }
  try {
    const text = readSmallFile(join(directory.path, 'install.json'));
    const installation = text === undefined ? undefined : installationOf(JSON.parse(text));
    if (installation === undefined) {
      return undefined;
    }
    return realpathSync(installation.path) === realpathSync(lookup.executable)
      ? installation
      : undefined;
  } catch {
    return undefined;
  }
}

export type { InstallationLookup };
export { readInstallation };
