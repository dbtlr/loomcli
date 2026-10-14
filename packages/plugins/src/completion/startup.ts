/**
 * Whether the plugin may change a startup file, judged before it writes anything: the file read
 * as the installed-files module reads it, resolved through symbolic links to its real path, and
 * the nearest folder at or above it that exists.
 */
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import { errorCode, exists } from '../installation/disk.js';
import { inspectStartupFile } from '../installation/files.js';

/**
 * What a startup file is to the plugin: not a regular file or nothing, one it may change, or one it
 * cannot change. `holds` says whether the file holds the line asked about, `false` for a file that
 * does not exist, and is unknown for a file the process may not read or in an encoding the module
 * does not read.
 */
type StartupJudgement =
  | { readonly kind: 'not-file' }
  | { readonly kind: 'changeable'; readonly holds: boolean }
  | { readonly kind: 'unchangeable'; readonly holds: boolean | undefined };

/** The runtime errors that say the process may not write a path. */
const deniedCodes = new Set(['EACCES', 'EPERM', 'EROFS']);

/**
 * Whether a runtime error says the process may not write a path, as a missing permission, an
 * operation the system forbids, or a read-only file system does, rather than a failure to report.
 */
function deniesWrite(error: unknown): boolean {
  return deniedCodes.has(String(errorCode(error)));
}

/** Whether the process may write the path, which exists. */
function mayWrite(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch (error) {
    if (deniesWrite(error)) {
      return false;
    }
    throw error;
  }
}

/** The nearest folder at or above `path` that exists. */
function nearestExisting(path: string): string {
  const parent = dirname(path);
  return exists(path) || parent === path ? path : nearestExisting(parent);
}

/**
 * Whether a file belongs to another user, which off `win32` makes it one the plugin cannot change.
 * A runtime that reports no user, as on `win32`, owns every file it may write.
 */
function ownedByAnother(file: {
  readonly owner: number;
  readonly user: number | undefined;
  readonly platform: string;
}): boolean {
  return file.platform !== 'win32' && file.user !== undefined && file.owner !== file.user;
}

/** Whether the plugin may change a file that exists: write it and its folder, and own it. */
function mayChangeFile(path: string, platform: string): boolean {
  const real = realpathSync(path);
  const owner = statSync(real).uid;
  return (
    mayWrite(real) &&
    mayWrite(dirname(real)) &&
    !ownedByAnother({ owner, platform, user: process.getuid?.() })
  );
}

/**
 * Judges a startup file for one line: not a file, one the process may not read or in an encoding
 * the module does not read, which the plugin cannot change, or, by whether the process may write it, its folder, or the
 * nearest folder that exists and whether another user owns it, one it may or may not change.
 */
function judgeStartup(path: string, line: string, platform: string): StartupJudgement {
  const state = inspectStartupFile(path, line);
  switch (state.kind) {
    case 'not-file': {
      return { kind: 'not-file' };
    }
    case 'unknown-encoding':
    case 'unreadable': {
      return { holds: undefined, kind: 'unchangeable' };
    }
    case 'absent': {
      const changeable = mayWrite(nearestExisting(dirname(path)));
      return { holds: false, kind: changeable ? 'changeable' : 'unchangeable' };
    }
    default: {
      const changeable = mayChangeFile(path, platform);
      return { holds: state.holds, kind: changeable ? 'changeable' : 'unchangeable' };
    }
  }
}

/**
 * Whether a run that would change the line in the file must release it instead: the plugin cannot
 * change the file, and the file holds the line or cannot be read to tell.
 */
function mustRelease(judgement: StartupJudgement): boolean {
  return judgement.kind === 'unchangeable' && judgement.holds !== false;
}

export type { StartupJudgement };
export { deniesWrite, judgeStartup, mustRelease, ownedByAnother };
