/**
 * What the installed-files module observes on disk and the writes it makes there, each through a
 * synchronous call whose failure throws the runtime's error.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

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
    ? { digest: digestOf(readFileSync(path)), kind: 'file', mode: stats.mode & permissionBits }
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

/** The suffix that marks a folder moved aside during a replacement, which recovery removes. */
const retiredSuffix = '.loom-retired';

/** A marked path beside `path`, `.<name>.<random><suffix>`, unique to the attempt. */
function markedPath(path: string, suffix: string): string {
  return join(
    dirname(path),
    `.${basename(path)}.${randomBytes(stagingBytes).toString('hex')}${suffix}`,
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
 * Creates `path` whole when nothing is there: the content goes to a staging file created
 * exclusively in its directory, which is then linked into place, so no other run sees the file
 * before it holds every byte.
 * The staging file is removed either way.
 * A file system that refuses hard links, such as some network mounts, gets the file created
 * exclusively in place instead.
 * Answers `false`, leaving `path` as it is, when something is already there.
 */
function publishFile(path: string, content: Uint8Array, options: ReplaceOptions = {}): boolean {
  const staging = stagingPath(path);
  try {
    fill(openSync(staging, 'wx', options.mode ?? defaultMode), content, options);
    const linked = linkNew(staging, path);
    return linked === 'refused' ? createNew(path, content, options) : linked === 'linked';
  } finally {
    removeStaging(staging);
  }
}

/** Links `existing` at `path`: `exists` when something is already there, `refused` when the file system allows no link. */
function linkNew(existing: string, path: string): 'exists' | 'linked' | 'refused' {
  try {
    linkSync(existing, path);
    return 'linked';
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EEXIST') {
      return 'exists';
    }
    if (
      code === 'EPERM' ||
      code === 'ENOTSUP' ||
      code === 'EOPNOTSUPP' ||
      code === 'EXDEV' ||
      code === 'ENOSYS'
    ) {
      return 'refused';
    }
    throw error;
  }
}

/** Creates `path` exclusively and writes `content` through it, or answers `false` when something is already there. */
function createNew(path: string, content: Uint8Array, options: ReplaceOptions): boolean {
  try {
    fill(openSync(path, 'wx', options.mode ?? defaultMode), content, options);
    return true;
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

/** Removes a staging file after a replacement or publication, leaving any failure to recovery's next run. */
function removeStaging(staging: string): void {
  try {
    rmSync(staging, { force: true });
  } catch {
    // The replacement's own error is the one to report; a later run removes the leftover.
  }
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

/** Removes every staging file a run left beside `path`, and nothing else in its directory. */
function removeStagingFiles(path: string): void {
  const directory = dirname(path);
  for (const entry of entriesOf(directory)) {
    if (isStagingFile(entry, basename(path))) {
      rmSync(join(directory, entry), { force: true });
    }
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
      throw error;
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

export type { Observed, ReplaceOptions };
export {
  createDirectory,
  digestOf,
  entriesOf,
  errorCode,
  exists,
  isMarkedEntry,
  missingParents,
  observe,
  permissionBits,
  publishFile,
  realPath,
  removeEmptyDirectory,
  removeStagingFiles,
  replaceFile,
  retiredPath,
  retiredSuffix,
  stagingPath,
  stagingSuffix,
};
