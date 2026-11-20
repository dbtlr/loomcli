/**
 * The installed-folder writes of the installed-files module: a folder written whole through a
 * staging folder and renames, removed whole without following a symbolic link, and read against
 * recorded per-file digests. The project install of a skill uses the write with no record.
 */
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, posix } from 'node:path';

import {
  digestOf,
  entriesOf,
  exists,
  isMarkedEntry,
  lstatIfPresent,
  observe,
  replaceFile,
  retiredPath,
  retiredSuffix,
  stagingPath,
  stagingSuffix,
} from './disk.js';
import { writing } from './reach.js';
import type { FolderDigest, RecordedFolder, PendingFolder } from './record.js';

/** One file of an installed folder: its relative POSIX path, its content, and its permission bits. */
interface FolderFile {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly mode?: number;
  readonly generated?: true;
}

/**
 * Removes whatever is at `path` whole and reports whether anything was there. A symbolic link at
 * the path, or inside a folder, is removed as a link and never followed.
 */
function removeWhole(path: string): boolean {
  if (!exists(path)) {
    return false;
  }
  rmSync(path, { force: true, recursive: true });
  return true;
}

/**
 * Removes each leftover `.<name>.<random>.loom-staging` and `.<name>.<random>.loom-retired` beside
 * the folder at `path`, for that folder's own name alone, and answers the paths it removed.
 */
function removeFolderLeftovers(path: string): string[] {
  const directory = dirname(path);
  const removed: string[] = [];
  for (const entry of entriesOf(directory)) {
    const name = basename(path);
    if (isMarkedEntry(entry, name, stagingSuffix) || isMarkedEntry(entry, name, retiredSuffix)) {
      const leftover = join(directory, entry);
      removeWhole(leftover);
      removed.push(leftover);
    }
  }
  return removed;
}

/**
 * Creates each subfolder above a file one level at a time, never recursively, so a staging folder
 * that another run's recovery removed makes the create throw and is never made again.
 */
function createSubfolders(staging: string, path: string, made: Set<string>): void {
  const segments = path.split(posix.sep);
  segments.pop();
  let directory = staging;
  for (const segment of segments) {
    directory = join(directory, segment);
    if (!made.has(directory)) {
      mkdirSync(directory);
      made.add(directory);
    }
  }
}

/**
 * Writes each file under the staging folder, creating the subfolders it needs. It never creates the
 * staging folder itself: when the folder is gone, the write throws and nothing is published short.
 */
function fillFolder(staging: string, files: readonly FolderFile[]): void {
  const made = new Set<string>();
  for (const file of files) {
    createSubfolders(staging, file.path, made);
    const target = join(staging, ...file.path.split(posix.sep));
    replaceFile(target, file.content, file.mode === undefined ? {} : { mode: file.mode });
  }
}

/** Moves whatever is at `path` aside, a link as a link, and answers where it went, if anything was there. */
function moveAside(path: string): string | undefined {
  if (!exists(path)) {
    return undefined;
  }
  const retired = retiredPath(path);
  renameSync(path, retired);
  return retired;
}

/** Moves what is at `path` aside, renames the staging folder into place, and removes what was moved. */
function swapIn(staging: string, path: string): void {
  const retired = moveAside(path);
  renameSync(staging, path);
  if (retired !== undefined) {
    removeWhole(retired);
  }
}

/**
 * Writes the folder at `path` whole: it removes the leftovers of the folder's own name, builds the
 * folder in a staging folder created exclusively beside it, moves whatever is at the path aside,
 * renames the staging folder into place, and removes the retired one whole. The directory above the
 * path exists. A staging folder it cannot create, because a file sits in the way or the location
 * cannot be written, fails naming the folder's path. A later failure removes the staging folder and
 * throws the runtime's error; one between the two renames can leave the path empty and a retired
 * folder beside it, which the next write of that folder removes. It answers the leftovers it
 * removed.
 */
function writeFolder(path: string, files: readonly FolderFile[]): string[] {
  const leftovers = removeFolderLeftovers(path);
  const staging = stagingPath(path);
  writing(path, () => {
    mkdirSync(staging);
  });
  try {
    fillFolder(staging, files);
    swapIn(staging, path);
  } catch (error) {
    removeWhole(staging);
    throw error;
  }
  return leftovers;
}

const executeBits = 0o111;

/** Reads below a real folder without following any internal directory link. */
function observeIn(folder: string, path: string) {
  if (lstatIfPresent(folder)?.isDirectory() !== true) {
    return { kind: 'absent' } satisfies ReturnType<typeof observe>;
  }
  const parts = path.split('/');
  parts.pop();
  let at = folder;
  for (const part of parts) {
    at = join(at, part);
    if (lstatIfPresent(at)?.isDirectory() !== true) {
      return { kind: 'absent' } satisfies ReturnType<typeof observe>;
    }
  }
  return observe(join(folder, path));
}
/** Records each file's content digest and generated mark. */
function folderDigests(files: readonly FolderFile[]): FolderDigest[] {
  return files.map(({ path, content, generated }) => ({
    digest: digestOf(content),
    path,
    ...(generated ? { generated } : {}),
  }));
}
/** Lists recorded generated references that exist with changed content or kind. */
function changedReferences(folder: RecordedFolder): string[] {
  return (folder.files ?? [])
    .filter((file) => {
      if (!file.generated) {
        return false;
      }
      const seen = observeIn(folder.path, file.path);
      return seen.kind !== 'absent' && (seen.kind !== 'file' || seen.digest !== file.digest);
    })
    .map(({ path }) => path);
}
/**
 * Lists the wanted files that differ or are absent, and the recorded files this version no longer
 * writes that are still in the folder, in code point order.
 */
function staleFiles(
  path: string,
  files: readonly FolderFile[],
  recorded: readonly FolderDigest[] = [],
): string[] {
  const changed = files
    .filter((file) => {
      const seen = observeIn(path, file.path);
      return (
        seen.kind !== 'file' ||
        seen.digest !== digestOf(file.content) ||
        (file.mode !== undefined &&
          Boolean(seen.mode & executeBits) !== Boolean(file.mode & executeBits))
      );
    })
    .map((file) => file.path);
  return (
    [
      ...new Set([
        ...changed,
        ...recorded
          .filter(
            (file) =>
              !files.some((wanted) => wanted.path === file.path) &&
              observeIn(path, file.path).kind !== 'absent',
          )
          .map((file) => file.path),
      ]),
    ]
      // ES2022 has no toSorted, and the array was just created here.
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort((first, second) => Buffer.compare(Buffer.from(first), Buffer.from(second)))
  );
}
/**
 * Resolves a pending folder: its intended files once every one is in place, whatever else the
 * folder holds; otherwise its prior record while something is at the path, by its path alone for a
 * folder an earlier format recorded; its intended files when nothing is there; and no entry when
 * neither applies.
 */
function recoveredFolder(folder: PendingFolder): RecordedFolder[] {
  if (folder.prior === undefined) {
    return [{ path: folder.path }];
  }
  const intended = folder.intended;
  if (
    intended &&
    intended.every((file) => {
      const seen = observeIn(folder.path, file.path);
      return seen.kind === 'file' && seen.digest === file.digest;
    })
  ) {
    return [{ files: intended, path: folder.path }];
  }
  const held = exists(folder.path) ? folder.prior : intended;
  return held === null || held === undefined
    ? []
    : [{ path: folder.path, ...(held === 'path' ? {} : { files: held }) }];
}
export { changedReferences, folderDigests, staleFiles, recoveredFolder };

export type { FolderFile };
export { fillFolder, removeFolderLeftovers, removeWhole, writeFolder };
