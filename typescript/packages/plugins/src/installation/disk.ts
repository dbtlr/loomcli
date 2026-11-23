/**
 * What the installed-files module observes on disk and the writes it makes there, each through a
 * synchronous call whose failure throws the runtime's error. It reads `node:crypto` on first use,
 * so a run that hashes and stages no file never loads it (ADR-0135).
 */
import {
  accessSync,
  chmodSync,
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeSync,
  constants,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import type { Log } from '@loomcli/core';

import { nodeCrypto } from '../built-ins.js';
import { fileRemoved } from '../change-events.js';
import { changedMeanwhile, dangling, errorCode, readFailure, reading, writing } from './reach.js';

/** The permission bits of a file mode, without its file type. */
const permissionBits = 0o7777;

/** The mode a staging file is created with when the caller names none, before the umask applies. */
const defaultMode = 0o666;

/** What a path holds: nothing, a regular file with its digest and permission bits, a symbolic link, a directory, or another kind. */
type Observed =
  | { readonly kind: 'absent' }
  | { readonly kind: 'file'; readonly digest: string; readonly mode: number }
  | { readonly kind: 'link' }
  | { readonly kind: 'directory' }
  | { readonly kind: 'special' };

/** The digest of some bytes, as the record spells it. */
function digestOf(content: string | Uint8Array): string {
  return `sha256:${nodeCrypto().createHash('sha256').update(content).digest('hex')}`;
}

/**
 * What `lstat` finds at `path` without following a link, or `undefined` when nothing is there. A
 * file where one of its folders is needed, or a link to a folder that does not exist, fails the
 * read, naming the path, because the path may still hold what the record says once the folder is
 * back.
 */
function lstatIfPresent(path: string): Stats | undefined {
  const stats = reading(path, () => lstatSync(path, { throwIfNoEntry: false }));
  if (stats === undefined && hasDanglingLink(dirname(path))) {
    throw dangling(path);
  }
  return stats;
}

/**
 * Whether `path`, or the nearest folder above it that exists, is a symbolic link to a folder that
 * does not exist, as a dotfile manager can leave behind: that link is read without following it,
 * and then followed. Every failure that says a missing path is below such a link asks this first,
 * so a path another run took away, with no link on it, is never reported as one.
 */
function hasDanglingLink(path: string): boolean {
  let folder = path;
  let stats = reading(folder, () => lstatSync(folder, { throwIfNoEntry: false }));
  while (stats === undefined && dirname(folder) !== folder) {
    folder = dirname(folder);
    const above = folder;
    stats = reading(above, () => lstatSync(above, { throwIfNoEntry: false }));
  }
  const link = folder;
  return (
    stats?.isSymbolicLink() === true &&
    reading(link, () => statSync(link, { throwIfNoEntry: false })) === undefined
  );
}

/** What `path` holds, read without following a symbolic link. */
function observe(path: string): Observed {
  const stats = lstatIfPresent(path);
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
    ? {
        digest: digestOf(reading(path, () => readFileSync(path))),
        kind: 'file',
        mode: stats.mode & permissionBits,
      }
    : { kind: 'special' };
}

/** Whether anything is at `path`, a symbolic link included, without reading it. */
function exists(path: string): boolean {
  return lstatIfPresent(path) !== undefined;
}

/** The suffix that marks a staging file, which recovery removes when a run leaves one behind. */
const stagingSuffix = '.loom-staging';

/** How many random bytes name a staging file, and the 16 lowercase hexadecimal digits they spell. */
const stagingBytes = 8;
const stagingRandom = /^[\da-f]{16}$/u;

/** The suffix that marks a folder moved aside during a replacement, which recovery removes. */
const retiredSuffix = '.loom-retired';

/** A marked path beside `path`, `.<name>.<random><suffix>`, unique to the attempt. */
function markedPath(path: string, suffix: string): string {
  return join(
    dirname(path),
    `.${basename(path)}.${nodeCrypto().randomBytes(stagingBytes).toString('hex')}${suffix}`,
  );
}

/** A staging file's path beside `path`, `.<name>.<random>.loom-staging`, unique to the attempt. */
function stagingPath(path: string): string {
  return markedPath(path, stagingSuffix);
}

/** The path a folder at `path` is moved aside to, `.<name>.<random>.loom-retired`. */
function retiredPath(path: string): string {
  return markedPath(path, retiredSuffix);
}

/**
 * How a replacement writes its staging file: the permission bits it takes whatever the umask, whether
 * it is flushed to disk before the rename, and the signal read just before the rename.
 */
interface ReplaceOptions {
  readonly mode?: number;
  readonly durable?: boolean;
  readonly signal?: AbortSignal;
}

/** Writes every byte of `content` to the descriptor, however many writes it takes. */
function writeAll(descriptor: number, content: Uint8Array): void {
  for (let written = 0; written < content.length;) {
    written += writeSync(descriptor, content, written);
  }
}

/** Fills the open staging file, sets its mode and flushes it when asked, and closes it. */
function fill(descriptor: number, content: Uint8Array, options: ReplaceOptions): void {
  try {
    writeAll(descriptor, content);
    if (options.mode !== undefined) {
      fchmodSync(descriptor, options.mode);
    }
    if (options.durable === true) {
      fsyncSync(descriptor);
    }
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Replaces `path` whole: the content goes to a staging file created exclusively in its directory,
 * which is then renamed into place, so no reader and no other run sees partial content there. A
 * failed write or rename, or an abort read before the rename, removes the staging file and throws
 * the original error or the signal's reason.
 */
function replaceFile(
  path: string,
  content: string | Uint8Array,
  options: ReplaceOptions = {},
): void {
  const staging = stagingPath(path);
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  try {
    fill(openSync(staging, 'wx', options.mode ?? defaultMode), bytes, options);
    options.signal?.throwIfAborted();
    renameSync(staging, path);
  } catch (error) {
    removeStaging(staging);
    throw error;
  }
}

/**
 * Creates `path` exclusively and appends `content` through it, or answers `false` when something
 * is already there. The descriptor appends, so a line another run appends between the create and
 * this write lands whole before `content` rather than under it.
 */
function createNew(path: string, content: Uint8Array, options: ReplaceOptions): boolean {
  try {
    fill(openSync(path, 'ax', options.mode ?? defaultMode), content, options);
    return true;
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

/** Removes a staging file after a replacement, leaving any failure to recovery's next run. */
function removeStaging(staging: string): void {
  try {
    rmSync(staging, { force: true });
  } catch {
    // The replacement's own error is the one to report; a later run removes the leftover.
  }
}

/**
 * The names in a directory, or none when the directory is gone. A file at the directory's path, or
 * where one of its folders is needed, fails the read, naming the directory.
 */
function entriesOf(directory: string): string[] {
  try {
    return reading(directory, () => readdirSync(directory));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/** Whether `entry` is `.<name>.<random><suffix>`, for the name `name` alone and 16 lowercase hex digits. */
function isMarkedEntry(entry: string, name: string, suffix: string): boolean {
  const prefix = `.${name}.`;
  return (
    entry.startsWith(prefix) &&
    entry.endsWith(suffix) &&
    stagingRandom.test(entry.slice(prefix.length, -suffix.length))
  );
}

/** Whether `entry` names a staging file of the file `name`: `.<name>.<random>.loom-staging`. */
function isStagingFile(entry: string, name: string): boolean {
  return isMarkedEntry(entry, name, stagingSuffix);
}

/**
 * Removes every staging file a run left beside `path`, and nothing else in its directory, and
 * answers the paths it removed. A removal its folder refuses fails naming `path`, the file the
 * folder holds.
 */
function removeStagingFiles(path: string): string[] {
  const directory = dirname(path);
  const removed: string[] = [];
  for (const entry of entriesOf(directory)) {
    if (isStagingFile(entry, basename(path))) {
      const staging = join(directory, entry);
      writing(path, () => {
        rmSync(staging, { force: true });
      });
      removed.push(staging);
    }
  }
  return removed;
}

/**
 * Records each leftover a removal answered as `File removed.`, so every site that removes leftover
 * staging files or folders records them one way, as in
 * `recordLeftovers(log, removeStagingFiles(path))`.
 */
function recordLeftovers(log: Log, removed: readonly string[]): void {
  for (const path of removed) {
    fileRemoved(log, { path });
  }
}

/**
 * Creates one directory whose parent exists, with the permission bits `mode` names whatever the
 * umask, when it names any; one another process created first is no error and keeps its own mode.
 */
function createDirectory(path: string, mode?: number): void {
  try {
    mkdirSync(path);
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw error;
    }
    return;
  }
  if (mode !== undefined) {
    chmodSync(path, mode);
  }
}

/**
 * Removes a directory when it is empty; one that holds anything, or is gone, stays as it is. A file
 * where one of its folders is needed fails the removal, naming the directory.
 */
function removeEmptyDirectory(path: string): void {
  if (lstatIfPresent(path)?.isDirectory() !== true) {
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

/** Whether a runtime error says the path, or a part of it, does not exist. */
function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * The real path of `path` through the nearest ancestor that exists: that ancestor is resolved
 * through every link, and the parts below it that do not exist are kept as they are.
 */
function realPath(path: string, below: readonly string[] = []): string {
  try {
    return join(realpathSync(path), ...below);
  } catch (error) {
    const parent = dirname(path);
    if (!isMissing(error) || parent === path) {
      throw readFailure(path, error);
    }
    return realPath(parent, [basename(path), ...below]);
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

/**
 * The folder whose write permission decides whether `path` can be written, created, or removed,
 * and the path a failure names: the path's own folder when it exists, naming the path, and
 * otherwise the nearest folder above it that exists, naming the outermost missing folder, the one
 * a write would create first.
 */
function writableLocation(path: string): { readonly folder: string; readonly named: string } {
  const [outermost] = missingParents(path);
  return outermost === undefined
    ? { folder: dirname(path), named: path }
    : { folder: dirname(outermost), named: outermost };
}

/**
 * Checks, before a run writes or removes anything, that the run's user may write the folder each
 * path is written, created, or removed in, so a run that would fail partway fails first, naming the
 * path and a step. A path below a file fails the read, naming the path, and a folder another run
 * took away since the run planned fails as one another run changed.
 */
function checkWritable(paths: readonly string[]): void {
  for (const path of paths) {
    const { folder, named } = writableLocation(path);
    mayWrite(named, folder);
  }
}

/**
 * Checks that the run's user may reach `folder` as `access` asks, failing naming `named`, and
 * answers whether the folder is there: a folder that is, or is below, a link to a folder that does
 * not exist fails as one, and one the user may not write or search fails as a write. A folder that
 * is gone with no such link on it answers `false`, and the caller decides what that means.
 */
function accessible(named: string, folder: string, access: number): boolean {
  try {
    writing(named, () => {
      accessSync(folder, access);
    });
    return true;
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
    if (hasDanglingLink(folder)) {
      throw dangling(named);
    }
    return false;
  }
}

/**
 * Checks that the run's user may write `folder`, which existed when the run planned, failing naming
 * `named`. A folder that is gone by the check, with no link to a missing folder on it, was taken by
 * another run, so the run fails saying so before it changes anything.
 */
function mayWrite(named: string, folder: string): void {
  if (!accessible(named, folder, constants.W_OK)) {
    throw changedMeanwhile(named);
  }
}

/**
 * Checks that the run's user may write and search the directory `directory` and then every
 * directory below it, read without following a symbolic link, each before it is read, so a failure
 * names the first directory in walk order that refuses, the one the operator makes writable. A
 * directory that is gone by the time the walk reaches it was taken by another run, which leaves
 * nothing in it to empty, so the walk passes over it.
 */
function checkWalk(directory: string): void {
  if (!accessible(directory, directory, constants.W_OK | constants.X_OK)) {
    return;
  }
  for (const entry of directoriesIn(directory)) {
    checkWalk(join(directory, entry));
  }
}

/**
 * The names of the directories in `directory`, each read without following a link, or none when
 * the directory is gone. The names are listed first and each entry's type read after, so an entry
 * another run takes away in between is passed over alone and every other entry is still answered.
 */
function directoriesIn(directory: string): string[] {
  return entriesOf(directory).filter((entry) => {
    const path = join(directory, entry);
    return reading(path, () => lstatSync(path, { throwIfNoEntry: false }))?.isDirectory() === true;
  });
}

/**
 * Checks, before a run replaces or removes the folders at `folders`, that the run's user may empty
 * each one that is a directory: write and search it and every directory below it, read without
 * following a symbolic link. A folder it may not empty fails naming the first directory in it that
 * refuses. Anything else at a folder's path is removed alone and needs no more, and a folder, or a
 * directory in it, that another run took away before the check reaches it is passed over.
 */
function checkEmptiable(folders: readonly string[]): void {
  for (const folder of folders) {
    if (lstatIfPresent(folder)?.isDirectory() === true) {
      checkWalk(folder);
    }
  }
}

/**
 * The leftover staging and retired folders beside the folder at `path`,
 * `.<name>.<random>.loom-staging` and `.<name>.<random>.loom-retired` for that folder's own name
 * alone, which a write of the folder or a recovery removes.
 */
function folderLeftovers(path: string): string[] {
  const directory = dirname(path);
  const name = basename(path);
  return entriesOf(directory)
    .filter(
      (entry) =>
        isMarkedEntry(entry, name, stagingSuffix) || isMarkedEntry(entry, name, retiredSuffix),
    )
    .map((entry) => join(directory, entry));
}

export type { Observed, ReplaceOptions };
export {
  checkEmptiable,
  checkWritable,
  createDirectory,
  createNew,
  digestOf,
  entriesOf,
  exists,
  folderLeftovers,
  hasDanglingLink,
  isMarkedEntry,
  lstatIfPresent,
  missingParents,
  observe,
  permissionBits,
  realPath,
  recordLeftovers,
  removeEmptyDirectory,
  removeStagingFiles,
  replaceFile,
  retiredPath,
  retiredSuffix,
  stagingPath,
  stagingSuffix,
};
export { errorCode } from './reach.js';
