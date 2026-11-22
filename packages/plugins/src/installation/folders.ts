/**
 * The installed-folder writes of the installed-files module: a folder written whole through a
 * staging folder and renames, claimed by a rename and removed whole without following a symbolic
 * link, and read against recorded per-file digests. The project install of a skill uses the write
 * with no record.
 */
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, posix } from 'node:path';

import { FatalError } from '@loomcli/core';

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
import { installationPhrase } from './phrases.js';
import { errorCode, writing } from './reach.js';
import type { FolderDigest, RecordedFolder, PendingFolder } from './record.js';

/** One file of an installed folder: its relative POSIX path, its content, and its permission bits. */
interface FolderFile {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly mode?: number;
  readonly generated?: true;
}

/**
 * Removes an entry this run holds whole: one it claimed under a retired name, one it moved aside, or
 * its own staging folder. A symbolic link at the path, or inside a folder, is removed as a link and
 * never followed, and an entry that is already gone is no error.
 */
function removeHeld(path: string): void {
  rmSync(path, { force: true, recursive: true });
}

/**
 * Renames the entry at `entry` to a fresh retired name of the folder at `path` and answers that
 * name, or nothing when the entry is gone by the rename.
 */
function claim(path: string, entry: string): string | undefined {
  const claimed = retiredPath(path);
  try {
    renameSync(entry, claimed);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  return claimed;
}

/**
 * Whether a call failed because a folder is not empty: a rename onto a folder that holds entries,
 * or the removal of one that still holds entries as it ends. That is `ENOTEMPTY`, or `EEXIST`,
 * which POSIX allows in its place.
 */
function notEmpty(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOTEMPTY' || code === 'EEXIST';
}

/**
 * Removes an entry this run claimed under a retired name whole and reports whether it is gone. A
 * write another run began before the claim can land in the entry while the removal runs, so the
 * entry is not empty as the removal ends: it then keeps its retired name, which a later cleanup
 * removes.
 */
function removeClaimed(claimed: string): boolean {
  try {
    removeHeld(claimed);
  } catch (error) {
    if (notEmpty(error)) {
      return false;
    }
    throw error;
  }
  return true;
}

/**
 * Removes whatever is at `path` whole and reports whether anything was there. It claims the entry
 * first, by renaming it to a fresh retired name of that folder, then removes the renamed entry, so
 * a folder another run publishes at the path meanwhile stays whole, and a path that is gone by the
 * rename is passed over. A symbolic link at the path, or inside a folder, is removed as a link and
 * never followed. An entry that is claimed and not fully removed is gone from the path, so the
 * removal still reports that something was there, and the rest keeps its retired name, which a
 * later cleanup removes, as it does when this run stops or fails before the removal.
 */
function removeWhole(path: string): boolean {
  if (!exists(path)) {
    return false;
  }
  const claimed = claim(path, path);
  if (claimed === undefined) {
    return false;
  }
  removeClaimed(claimed);
  return true;
}

/**
 * Claims the leftover at `leftover` beside the folder at `path` and removes it whole: it renames the
 * leftover to a fresh retired name of that folder, then removes the renamed entry, and reports
 * whether it removed one. A leftover that is gone by the rename is passed over, and a rename the
 * location does not allow fails naming the folder's path. The rename takes the path away from a run
 * still writing that staging folder, so the run's next write in it fails, or its rename into place
 * fails when it has written every file, and it never publishes the folder with files missing. Only a
 * write that run began before the rename can still land in the claimed entry, and when one leaves
 * it not empty, the entry keeps its retired name and is not reported. The retired name lets a later
 * cleanup remove the entry, as it does when this run stops before the removal.
 */
function claimLeftover(path: string, leftover: string): boolean {
  const claimed = writing(path, () => claim(path, leftover));
  return claimed !== undefined && removeClaimed(claimed);
}

/**
 * Removes each leftover `.<name>.<random>.loom-staging` and `.<name>.<random>.loom-retired` beside
 * the folder at `path`, for that folder's own name alone, by claiming it first, and answers the
 * paths it removed whole.
 */
function removeFolderLeftovers(path: string): string[] {
  const directory = dirname(path);
  const name = basename(path);
  return entriesOf(directory)
    .filter(
      (entry) =>
        isMarkedEntry(entry, name, stagingSuffix) || isMarkedEntry(entry, name, retiredSuffix),
    )
    .map((entry) => join(directory, entry))
    .filter((leftover) => claimLeftover(path, leftover));
}

/**
 * Creates each subfolder above a file one level at a time, never recursively, so a staging folder
 * that another run's cleanup claimed makes the create throw and is never made again.
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

/**
 * Renames what was moved aside back to `path`, after the staging folder could not take its place.
 * A failed rename leaves it as it is: another run's cleanup claimed it, or another run's folder is
 * already at the path, and a later cleanup removes it.
 */
function moveBack(retired: string, path: string): void {
  try {
    renameSync(retired, path);
  } catch {
    // The rename into place failed first, and that failure is the one to report.
  }
}

/** The failure of a folder write at `path` that another run overtook. */
function changedMeanwhile(path: string): FatalError {
  return new FatalError(installationPhrase('folderChangedMeanwhile', path));
}

/**
 * Moves what is at `path` aside, renames the staging folder into place, and removes what was moved.
 * A rename into place that fails moves what was there back. One that fails because a folder holds
 * the path, which another run published after the move aside, fails naming the folder's path.
 */
function swapIn(staging: string, path: string): void {
  const retired = moveAside(path);
  try {
    renameSync(staging, path);
  } catch (error) {
    if (retired !== undefined) {
      moveBack(retired, path);
    }
    throw notEmpty(error) ? changedMeanwhile(path) : error;
  }
  if (retired !== undefined) {
    removeHeld(retired);
  }
}

/**
 * Writes the folder at `path` whole: it removes the leftovers of the folder's own name, builds the
 * folder in a staging folder created exclusively beside it, moves whatever is at the path aside,
 * renames the staging folder into place, and removes the retired one whole. The directory above the
 * path exists. A staging folder it cannot create, because a file sits in the way or the location
 * cannot be written, fails naming the folder's path. Once the staging folder exists, another run
 * can overtake the write: its cleanup can claim the staging folder, its removal can claim the folder
 * or its write move the folder aside just as this run moves it, which leaves a path missing, or its
 * write can publish its own folder at the path after this run moved the old one aside, which the
 * rename into place meets. Each fails the write naming the folder's path. Any other later failure
 * throws the runtime's error. Every failure after the staging folder exists removes it, and one at
 * the rename into place first moves the old folder back, unless another run claimed it or holds the
 * path with its own folder. A run stopped between the two renames leaves the path empty and a
 * retired folder beside it, which the next write of that folder removes. It answers the leftovers
 * it removed.
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
    removeHeld(staging);
    throw errorCode(error) === 'ENOENT' ? changedMeanwhile(path) : error;
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
