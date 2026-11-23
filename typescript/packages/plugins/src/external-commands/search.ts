import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** The extensions a spawn without a shell starts on Windows, in the order libuv and `PATHEXT` try them. */
const windowsExtensions = ['.com', '.exe'] as const;

/** What the search reads of the run's host. */
interface SearchFacts {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: string;
}

/** What the search reports as it goes: each entry it passed over. */
type PassedOver = (folder: string) => void;

/** Whether the run is on Windows, where a variable's name has no case and a file no execute bit. */
function onWindows(facts: SearchFacts): boolean {
  return facts.platform === 'win32';
}

/**
 * The run's `PATH`. On Windows it follows Node's rule for a child's environment: the keys sorted,
 * the first that matches `PATH` without regard to case, so `PATH` wins over `Path`.
 */
function pathOf(facts: SearchFacts): string {
  if (!onWindows(facts)) {
    return facts.env.PATH ?? '';
  }
  // The first in sorted order is the least name, so `PATH` wins over `Path`.
  const key = Object.keys(facts.env)
    .filter((name) => name.toUpperCase() === 'PATH')
    .reduce<string | undefined>(
      (least, name) => (least === undefined || name < least ? name : least),
      undefined,
    );
  return (key === undefined ? undefined : facts.env[key]) ?? '';
}

/**
 * Whether one path is a candidate: a regular file, a symbolic link followed, that the run's user may
 * execute. Windows has no execute bit, so a regular file is enough there. A missing file, a
 * dangling link, a directory, and a file the user may not execute are not candidates.
 */
function isCandidate(path: string, windows: boolean): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    if (!windows) {
      accessSync(path, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/** The absolute entries of the run's `PATH`, in order; a relative or empty one is skipped. */
function foldersOf(facts: SearchFacts, windows: boolean): string[] {
  return pathOf(facts)
    .split(windows ? ';' : ':')
    .filter((folder) => isAbsolute(folder));
}

/** The first candidate of the given names in one folder, or `undefined`. */
function foundIn(folder: string, names: readonly string[], windows: boolean): string | undefined {
  return names
    .map((candidate) => join(folder, candidate))
    .find((path) => isCandidate(path, windows));
}

/**
 * The absolute path of the first candidate named `name` on the run's `PATH`, or `undefined` when
 * none is. Entries are read in order, and one that is not an absolute path, an empty one included,
 * is skipped, so the working directory is never searched. On Windows each entry is tried for
 * `name.com` and then `name.exe`. `passed` hears each entry that holds no candidate.
 */
function findProgram(name: string, facts: SearchFacts, passed: PassedOver): string | undefined {
  const windows = onWindows(facts);
  const names = windows ? windowsExtensions.map((extension) => `${name}${extension}`) : [name];
  for (const folder of foldersOf(facts, windows)) {
    const found = foundIn(folder, names, windows);
    if (found !== undefined) {
      return found;
    }
    passed(folder);
  }
  return undefined;
}

export type { SearchFacts };
export { findProgram };
