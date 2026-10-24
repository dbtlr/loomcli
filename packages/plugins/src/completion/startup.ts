/**
 * Whether the plugin may change a startup file, judged before it writes anything: the file read
 * as the installed-files module reads it, resolved through symbolic links to its real path, and
 * the nearest folder at or above it that exists. A line goes into a file the plugin may change, and
 * is printed for the operator when it may not.
 */
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import { errorCode, exists } from '../installation/disk.js';
import { inspectStartupFile } from '../installation/files.js';
import type { InstalledLine } from '../installation/files.js';
import { lines } from './messages.js';
import { removeNotice } from './run.js';
import type { ChildRun, Notice } from './run.js';

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
 * Whether a file belongs to another user, which makes it one the plugin cannot change. A runtime
 * that reports no user owns every file it may write.
 */
function ownedByAnother(file: {
  readonly owner: number;
  readonly user: number | undefined;
}): boolean {
  return file.user !== undefined && file.owner !== file.user;
}

/**
 * Whether the plugin may change a file that exists: write it and its folder, and own it, as the
 * run's user, which a runtime with no user ID reports as `undefined`.
 */
function mayChangeFile(path: string, user: number | undefined): boolean {
  const real = realpathSync(path);
  const owner = statSync(real).uid;
  return mayWrite(real) && mayWrite(dirname(real)) && !ownedByAnother({ owner, user });
}

/**
 * Judges a startup file for one line: not a file, one the process may not read or in an encoding
 * the module does not read, which the plugin cannot change, or, by whether the process may write
 * it, its folder, or the nearest folder that exists and whether another user owns it, one it may
 * or may not change.
 */
function judgeStartup(path: string, line: string, user: number | undefined): StartupJudgement {
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
      const changeable = mayChangeFile(path, user);
      return { holds: state.holds, kind: changeable ? 'changeable' : 'unchangeable' };
    }
  }
}

/**
 * Whether a run that would change a recorded line in its file must release it instead: the plugin
 * cannot change the file, and the file holds the line or cannot be read to tell.
 */
function mustRelease(judgement: StartupJudgement): boolean {
  return judgement.kind === 'unchangeable' && judgement.holds !== false;
}

/**
 * What a run does with one startup file's line: the line it lists for the module, the startup file
 * whose recorded line it releases, the lines the operator adds or removes by hand, and the file
 * that already loads the script although the plugin may not change it.
 */
interface LinePlacement {
  readonly lines: readonly InstalledLine[];
  readonly release: readonly string[];
  readonly notices: readonly Notice[];
  readonly loaded: readonly string[];
}

/** What a run asks of one startup file: its path, the line it should hold, and the line recorded there. */
interface LineRequest {
  readonly path: string;
  readonly line: string;
  readonly recorded: string | undefined;
  /** Whether the run is an update, which asks the operator for no line the record did not hold. */
  readonly update: boolean;
}

/** A startup file the plugin has judged to be a file or nothing. */
type Placeable = Exclude<StartupJudgement, { kind: 'not-file' }>;

/** The count of an empty list. */
const none = 0;

/**
 * The line recorded in a startup file the plugin may not change, dropped from the record with no
 * write: released when the file holds it, may hold it, or holds the new line, and printed for the
 * operator to remove when its text differs from the new line's.
 */
function recordedHere(
  run: ChildRun,
  { line, path, recorded }: LineRequest,
  judgement: Placeable,
): Pick<LinePlacement, 'notices' | 'release'> {
  if (recorded === undefined) {
    return { notices: [], release: [] };
  }
  const held = mustRelease(judgeStartup(path, recorded, run.host.uid));
  return {
    notices: held && recorded !== line ? [removeNotice(run, { line: recorded, path })] : [],
    release: held || judgement.holds === true ? [path] : [],
  };
}

/**
 * Places a line in a startup file the plugin has judged. One it may change gets the line listed,
 * so the module writes and records it. One it may not change gets no line recorded: its recorded
 * line is dropped, and the new line is printed for the operator to add, unless the file already
 * holds it or an update finds no line there to replace.
 */
function placeLine(run: ChildRun, request: LineRequest, judgement: Placeable): LinePlacement {
  const { line, path, update } = request;
  if (judgement.kind === 'changeable') {
    return { lines: [{ line, path }], loaded: [], notices: [], release: [] };
  }
  const { notices, release } = recordedHere(run, request, judgement);
  if (judgement.holds === true || (update && notices.length === none)) {
    return { lines: [], loaded: judgement.holds === true ? [path] : [], notices, release };
  }
  const sentence =
    notices.length === none ? lines.addYourself(run.name, path) : lines.addInPlace(path);
  return { lines: [], loaded: [], notices: [...notices, { line, sentence }], release };
}

export type { LinePlacement, StartupJudgement };
export { deniesWrite, judgeStartup, mustRelease, ownedByAnother, placeLine };
