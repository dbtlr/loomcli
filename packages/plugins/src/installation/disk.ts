/**
 * What the installed-files module observes on disk and the writes it makes there, each through a
 * synchronous call whose failure throws the runtime's error.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** What a path holds: nothing, a regular file and its digest, a symbolic link, a directory, or another kind. */
type Observed =
  | { readonly kind: 'absent' }
  | { readonly kind: 'file'; readonly digest: string }
  | { readonly kind: 'link' }
  | { readonly kind: 'directory' }
  | { readonly kind: 'special' };

/** The runtime error's code, such as `ENOENT`, or `undefined` for a value that carries none. */
function errorCode(error: unknown): unknown {
  return error instanceof Error ? Reflect.get(error, 'code') : undefined;
}

/** The digest of some bytes, as the record spells it. */
function digestOf(content: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/** What `path` holds, read without following a symbolic link. */
function observe(path: string): Observed {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (stats === undefined) {
    return { kind: 'absent' };
  }
  if (stats.isSymbolicLink()) {
    return { kind: 'link' };
  }
  if (stats.isDirectory()) {
    return { kind: 'directory' };
  }
  return stats.isFile()
    ? { digest: digestOf(readFileSync(path)), kind: 'file' }
    : { kind: 'special' };
}

/** Whether anything is at `path`, a symbolic link included, without reading it. */
function exists(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
}

/** The suffix that marks a staging file, which recovery removes when a run leaves one behind. */
const stagingSuffix = '.loom-staging';

/** How many random bytes name a staging file, and the 16 lowercase hexadecimal digits they spell. */
const stagingBytes = 8;
const stagingRandom = /^[\da-f]{16}$/u;

/** A staging file's path beside `path`, `.<name>.<random>.loom-staging`, unique to the attempt. */
function stagingPath(path: string): string {
  return join(
    dirname(path),
    `.${basename(path)}.${randomBytes(stagingBytes).toString('hex')}${stagingSuffix}`,
  );
}

/**
 * Replaces `path` whole: the content goes to a staging file created exclusively in its directory,
 * which is then renamed into place, so no reader and no other run sees partial content there.
 */
function replaceFile(path: string, content: string | Uint8Array): void {
  const staging = stagingPath(path);
  try {
    writeFileSync(staging, content, { flag: 'wx' });
  } catch (error) {
    rmSync(staging, { force: true });
    throw error;
  }
  renameSync(staging, path);
}

/** The names in a directory, or none when the directory is gone. */
function entriesOf(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/** Whether `entry` names a staging file of the file `name`: `.<name>.<random>.loom-staging`. */
function isStagingFile(entry: string, name: string): boolean {
  const prefix = `.${name}.`;
  return (
    entry.startsWith(prefix) &&
    entry.endsWith(stagingSuffix) &&
    stagingRandom.test(entry.slice(prefix.length, -stagingSuffix.length))
  );
}

/** Removes every staging file a run left beside `path`, and nothing else in its directory. */
function removeStagingFiles(path: string): void {
  const directory = dirname(path);
  for (const entry of entriesOf(directory)) {
    if (isStagingFile(entry, basename(path))) {
      rmSync(join(directory, entry), { force: true });
    }
  }
}

/** Creates one directory whose parent exists; one another process created first is no error. */
function createDirectory(path: string): void {
  try {
    mkdirSync(path);
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw error;
    }
  }
}

/** Removes a directory when it is empty; one that holds anything, or is gone, stays as it is. */
function removeEmptyDirectory(path: string): void {
  if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) {
    return;
  }
  try {
    rmdirSync(path);
  } catch (error) {
    const code = errorCode(error);
    if (code !== 'ENOTEMPTY' && code !== 'EEXIST' && code !== 'ENOENT') {
      throw error;
    }
  }
}

/** The missing directories above `path`, outermost first, which writing it needs created. */
function missingParents(path: string): string[] {
  const missing: string[] = [];
  let directory = dirname(path);
  while (!exists(directory)) {
    missing.unshift(directory);
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return missing;
}

export type { Observed };
export {
  createDirectory,
  digestOf,
  missingParents,
  observe,
  removeEmptyDirectory,
  removeStagingFiles,
  replaceFile,
};
