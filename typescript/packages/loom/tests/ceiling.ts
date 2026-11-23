import type { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, sep } from 'node:path';

/**
 * A ceiling at the sandbox root for the walks an in-process `loom` run makes up from a fixture
 * directory: to the nearest `package.json`, and to a `node_modules` that resolves a package. A test
 * file installs it by mocking `node:fs` with `ceiled`, which a `vi.mock` factory imports. Above the
 * ceiling, a `package.json` or `node_modules` entry reads as missing to `existsSync`, so a walk
 * ends at the sandbox whatever sits above the temporary directory, such as the checkout a `TMPDIR`
 * inside a repository leaves above every fixture.
 *
 * The ceiling is the temporary directory every fixture is created in, and `ceilAt` lowers it for
 * one test, which `restoreCeiling` undoes.
 */

/** The entries a walk up from a fixture looks for in each directory above it. */
const walkMarkers = new Set(['node_modules', 'package.json']);

/** The real temporary directory, which `ceiled` reads through the unmocked module. */
let temporaryCeiling: string | undefined = undefined;

/** The ceiling a test lowered it to, when one did. */
let lowered: string | undefined = undefined;

/** Lowers the ceiling to a directory inside the sandbox until `restoreCeiling` runs. */
function ceilAt(directory: string) {
  lowered = directory;
}

/** Restores the ceiling to the temporary directory. */
function restoreCeiling() {
  lowered = undefined;
}

/**
 * Whether a walk up from below the ceiling reaches the path only by leaving the sandbox: the path
 * names an entry the walks look for in the ceiling or a directory above it. As with git's
 * `GIT_CEILING_DIRECTORIES`, the ceiling itself is out of bounds.
 */
function aboveCeiling(ceiling: string, path: string) {
  const inside = relative(ceiling, path);
  if (isAbsolute(inside)) {
    return false;
  }
  const entry = inside.split(sep).find((segment) => segment !== '..');
  return entry !== undefined && walkMarkers.has(entry);
}

/** The members of `node:fs` the ceiling reads and replaces. */
interface CeiledMembers {
  readonly existsSync: typeof existsSync;
  readonly realpathSync: typeof realpathSync;
}

/** The `node:fs` module with its `existsSync` capped at the ceiling. */
function ceiled<Fs extends CeiledMembers>(actual: Fs): Fs {
  temporaryCeiling ??= actual.realpathSync(tmpdir());
  const ceiling = temporaryCeiling;
  return {
    ...actual,
    existsSync: (path: Parameters<typeof existsSync>[0]) =>
      typeof path === 'string' && aboveCeiling(lowered ?? ceiling, path)
        ? false
        : actual.existsSync(path),
  };
}

export { ceilAt, ceiled, restoreCeiling };
