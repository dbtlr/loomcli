import { createHash, randomUUID } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** The permission bits of a file mode, without its file type. */
const permissionMask = 0o7777;

/** The mode a staging file starts with, before it is set to the mode it will keep. */
const privateMode = 0o600;

/** The SHA-256 digest of some bytes, as 64 lowercase hexadecimal digits. */
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** What the recorded path holds, read without following a symbolic link at the path itself. */
type Found =
  | { readonly kind: 'file'; readonly mode: number; readonly digest: string }
  | { readonly kind: 'link' }
  | { readonly kind: 'missing' };

/** The stats of `path` itself, or `undefined` when nothing can be read there. */
function statWithoutFollowing(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

/** The file at the recorded path: a regular file with its mode and digest, a link, or nothing. */
function inspectBinary(path: string): Found {
  const stats = statWithoutFollowing(path);
  if (stats === undefined) {
    return { kind: 'missing' };
  }
  if (stats.isSymbolicLink()) {
    return { kind: 'link' };
  }
  if (!stats.isFile()) {
    return { kind: 'missing' };
  }
  return { digest: sha256(readFileSync(path)), kind: 'file', mode: stats.mode & permissionMask };
}

/** The first directory the process cannot write to, with the runtime's error, or none. */
function unwritable(
  directories: readonly string[],
): { directory: string; cause: unknown } | undefined {
  for (const directory of directories) {
    try {
      accessSync(directory, constants.W_OK);
    } catch (error) {
      return { cause: error, directory };
    }
  }
  return undefined;
}

/** A staging file's name for `target`, unique to the attempt. */
function stagingName(target: string): string {
  return `.${basename(target)}.${randomUUID()}.loom-staging`;
}

/** Removes leftover staging files an earlier run of this binary left in its directory. */
function removeLeftovers(target: string): void {
  const prefix = `.${basename(target)}.`;
  for (const entry of readdirSync(dirname(target))) {
    if (entry.startsWith(prefix) && entry.endsWith('.loom-staging')) {
      rmSync(join(dirname(target), entry), { force: true });
    }
  }
}

/** Writes every byte of `bytes` to the descriptor, however many writes it takes. */
function writeAll(descriptor: number, bytes: Uint8Array): void {
  for (let written = 0; written < bytes.length;) {
    written += writeSync(descriptor, bytes, written);
  }
}

/** Fills the open staging file, sets `mode` on it, flushes it to disk, and closes it. */
function fillAndClose(descriptor: number, bytes: Uint8Array, mode: number): void {
  try {
    writeAll(descriptor, bytes);
    fchmodSync(descriptor, mode);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** The file to write, the bytes and mode it takes, and the signal read before the rename. */
interface Replacement {
  readonly target: string;
  readonly bytes: Uint8Array;
  readonly mode: number;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Writes `bytes` to a staging file created exclusively beside `target`, sets `mode` on it whatever
 * the umask, flushes it to disk, and renames it over `target`. A failure, or an abort read before
 * the rename, removes the staging file and leaves `target` as it was.
 */
function replaceFile({ target, bytes, mode, signal }: Replacement): void {
  const staging = join(dirname(target), stagingName(target));
  const descriptor = openSync(staging, 'wx', privateMode);
  try {
    fillAndClose(descriptor, bytes, mode);
    signal?.throwIfAborted();
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { force: true });
    throw error;
  }
}

export type { Found };
export { inspectBinary, removeLeftovers, replaceFile, sha256, unwritable };
