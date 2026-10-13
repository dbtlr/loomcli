/**
 * The installed-folder writes of the installed-files module: a folder written whole through a
 * staging folder and renames, removed whole without following a symbolic link, and read for whether
 * it holds exactly a list of files. The project install of a skill uses the write with no record.
 */
import { lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, posix } from 'node:path';

import {
  digestOf,
  entriesOf,
  exists,
  isMarkedEntry,
  observe,
  replaceFile,
  retiredPath,
  retiredSuffix,
  stagingPath,
  stagingSuffix,
} from './disk.js';

/** One file of an installed folder: its relative POSIX path, its content, and its permission bits. */
interface FolderFile {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly mode?: number;
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
 * the folder at `path`, for that folder's own name alone.
 */
function removeFolderLeftovers(path: string): void {
  const directory = dirname(path);
  for (const entry of entriesOf(directory)) {
    const name = basename(path);
    if (isMarkedEntry(entry, name, stagingSuffix) || isMarkedEntry(entry, name, retiredSuffix)) {
      removeWhole(join(directory, entry));
    }
  }
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
 * path exists. A failure removes the staging folder and throws the runtime's error; one between
 * the two renames can leave the path empty and a retired folder beside it, which the next write
 * of that folder removes.
 */
function writeFolder(path: string, files: readonly FolderFile[]): void {
  removeFolderLeftovers(path);
  const staging = stagingPath(path);
  mkdirSync(staging);
  try {
    fillFolder(staging, files);
    swapIn(staging, path);
  } catch (error) {
    removeWhole(staging);
    throw error;
  }
}

/** Every directory above a file of the list, as the relative paths the folder holds. */
function expectedDirectories(files: readonly FolderFile[]): Set<string> {
  const directories = new Set<string>();
  for (const { path } of files) {
    for (let up = posix.dirname(path); up !== '.'; up = posix.dirname(up)) {
      directories.add(up);
    }
  }
  return directories;
}

/** Whether the file at `path` is a regular file holding the listed content and, when named, mode. */
function fileMatches(path: string, file: FolderFile): boolean {
  const seen = observe(path);
  return (
    seen.kind === 'file' &&
    seen.digest === digestOf(file.content) &&
    (file.mode === undefined || seen.mode === file.mode)
  );
}

/** What a check of a folder expects, by relative path, and the files it found so far. */
interface Walk {
  readonly files: ReadonlyMap<string, FolderFile>;
  readonly directories: ReadonlySet<string>;
  readonly found: Set<string>;
}

/**
 * Whether every entry under `directory` is one the list expects, each file matching, recording the
 * files it finds in `walk`. A link, another kind of file, or an unexpected entry fails.
 */
function entriesMatch(directory: string, relative: string, walk: Walk): boolean {
  return readdirSync(directory).every((name) => {
    const path = join(directory, name);
    const key = relative === '' ? name : `${relative}/${name}`;
    const file = walk.files.get(key);
    if (file !== undefined) {
      walk.found.add(key);
      return fileMatches(path, file);
    }
    const isFolder = walk.directories.has(key) && lstatSync(path).isDirectory();
    return isFolder && entriesMatch(path, key, walk);
  });
}

/**
 * Whether the folder at `path` holds exactly `files`: each file with its content and, when the list
 * names one, its mode, and no other file or folder. Nothing is followed, so a symbolic link at the
 * path or inside the folder, or a path that is not a directory, answers false.
 */
function folderHoldsExactly(path: string, files: readonly FolderFile[]): boolean {
  if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) {
    return false;
  }
  const walk: Walk = {
    directories: expectedDirectories(files),
    files: new Map(files.map((file) => [file.path, file])),
    found: new Set<string>(),
  };
  return entriesMatch(path, '', walk) && walk.found.size === files.length;
}

export type { FolderFile };
export { fillFolder, folderHoldsExactly, removeFolderLeftovers, removeWhole, writeFolder };
