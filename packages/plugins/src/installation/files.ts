/**
 * The installed-files module the first-party plugins that install files outside the application
 * share, such as a completion script, a manual page, an agent skill, or a service unit. Each plugin
 * records what it wrote in its own file in the installation record, `<plugin>.json`, and never takes
 * over a file it did not record. The module is internal to the pack: no subpath exports it.
 */
import { rmSync } from 'node:fs';
import { isAbsolute, normalize, posix, sep } from 'node:path';

import {
  createDirectory,
  digestOf,
  exists,
  missingParents,
  observe,
  removeEmptyDirectory,
  removeStagingFiles,
  replaceFile,
} from './disk.js';
import type { Observed } from './disk.js';
import { removeFolderLeftovers, removeWhole, writeFolder } from './folders.js';
import type { FolderFile } from './folders.js';
import { nothingRecorded, pluginFilePath, readPluginFile, writePluginFile } from './record.js';
import type { Committed, CommittedFile, Pending, PendingFile, RecordedFolder } from './record.js';

/**
 * One file an install writes: its absolute path, the content it will hold, and the permission bits
 * it is written with whatever the umask, when the plugin names any.
 */
interface InstalledFile {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly mode?: number;
}

/**
 * One folder an install writes: its absolute path and the files it holds, which the install
 * writes whole in place of whatever the folder held.
 */
interface InstalledFolder {
  readonly path: string;
  readonly files: readonly FolderFile[];
}

/**
 * Why a path refuses an install or uninstall: a file or folder the plugin did not record, a recorded file
 * whose digest changed, a symbolic link, a directory, another kind of file, or a plugin's file that
 * is damaged or holds an unknown format.
 */
type RefusalReason =
  | 'unrecorded'
  | 'changed'
  | 'link'
  | 'directory'
  | 'special'
  | RecordRefusalReason;

/** Why the plugin's own file refuses an install or uninstall, the one refusal an uninstall has. */
type RecordRefusalReason = 'damaged' | 'unknown-format';

interface Refusal<Reason extends RefusalReason = RefusalReason> {
  readonly path: string;
  readonly reason: Reason;
}

/** What the plugin's Command states to the operator: the refused paths, or what was done. */
type InstallOutcome =
  | { readonly status: 'refused'; readonly refused: readonly Refusal[] }
  | {
      readonly status: 'installed';
      /** The files and the folders written. */
      readonly written: readonly string[];
      /** Recorded files the install no longer lists, removed because no one changed them, and recorded folders it no longer lists. */
      readonly removed: readonly string[];
      /** Recorded files the install no longer lists, kept because someone changed them. */
      readonly kept: readonly string[];
      /** Unrecorded folder paths the force mode took over; the member is absent when it took none. */
      readonly replaced?: readonly string[];
    };

type UninstallOutcome =
  | { readonly status: 'refused'; readonly refused: readonly Refusal<RecordRefusalReason>[] }
  | {
      readonly status: 'uninstalled';
      readonly removed: readonly string[];
      readonly kept: readonly string[];
    };

const EMPTY = 0;

/** Whose files: the record directory, which the caller resolves, the plugin, and its run's signal. */
interface UninstallRequest {
  readonly record: string;
  readonly plugin: string;
  readonly signal: AbortSignal;
}

/**
 * What an install writes: files, folders, or both. The force mode, which only the skills plugin
 * passes, replaces an unrecorded folder at a listed folder's path in place of refusing. The
 * directory mode is the permission bits each missing parent directory is created with, whatever
 * the umask, when the plugin names any.
 */
interface InstallRequest extends UninstallRequest {
  readonly files: readonly InstalledFile[];
  readonly folders?: readonly InstalledFolder[];
  readonly force?: boolean;
  readonly directoryMode?: number;
}

/**
 * Resolves a pending plugin's file by what is on disk: a path holding the intended or the prior
 * digest stays recorded with it, and one that is gone or holds any other digest is dropped. A
 * listed directory that exists stays, and so does every listed folder, whether or not it is there.
 * Leftover staging files and the staging and retired folders beside each listed folder are removed,
 * and the result is written as committed.
 */
function recover(path: string, pending: Pending): Committed {
  for (const entry of pending.files) {
    removeStagingFiles(entry.path);
  }
  for (const folder of pending.folders) {
    removeFolderLeftovers(folder.path);
  }
  const committed: Committed = {
    directories: pending.directories.filter((directory) => observe(directory).kind === 'directory'),
    files: pending.files.flatMap(recoveredFile),
    folders: pending.folders,
    state: 'committed',
  };
  writePluginFile(path, committed);
  return committed;
}

function recoveredFile(entry: PendingFile): CommittedFile[] {
  const seen = observe(entry.path);
  if (seen.kind !== 'file' || (seen.digest !== entry.intended && seen.digest !== entry.prior)) {
    return [];
  }
  return [{ digest: seen.digest, path: entry.path }];
}

/**
 * What the plugin's file records, a missing one recording nothing and a pending one recovered
 * first, or the refusal of a file the module cannot read. Leftover staging files of a plugin's file
 * it can read are removed.
 */
function recorded(
  path: string,
): { readonly committed: Committed } | { readonly refused: Refusal<RecordRefusalReason> } {
  const read = readPluginFile(path);
  if (read.kind === 'refused') {
    return { refused: { path, reason: read.reason } };
  }
  removeStagingFiles(path);
  if (read.kind === 'missing') {
    return { committed: nothingRecorded };
  }
  return { committed: read.file.state === 'pending' ? recover(path, read.file) : read.file };
}

/** The refusal a target is, or none for an absent target or a recorded file with its digest unchanged. */
function refusalOf(path: string, seen: Observed, digests: ReadonlyMap<string, string>): Refusal[] {
  switch (seen.kind) {
    case 'absent': {
      return [];
    }
    case 'file': {
      const digest = digests.get(path);
      if (digest === undefined) {
        return [{ path, reason: 'unrecorded' }];
      }
      return digest === seen.digest ? [] : [{ path, reason: 'changed' }];
    }
    default: {
      return [{ path, reason: seen.kind }];
    }
  }
}

/** Removes each recorded file whose digest is unchanged and keeps each one someone changed. */
function removeRecorded(files: readonly CommittedFile[]): { removed: string[]; kept: string[] } {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const { digest, path } of files) {
    const seen = observe(path);
    if (seen.kind === 'file' && seen.digest === digest) {
      rmSync(path);
      removed.push(path);
    } else if (seen.kind !== 'absent') {
      kept.push(path);
    }
  }
  return { kept, removed };
}

/** The refusal of a listed folder path that is not recorded and holds anything, a link included. */
function folderRefusals(
  paths: readonly string[],
  folders: readonly RecordedFolder[],
): readonly Refusal[] {
  const recordedPaths = new Set(folders.map(({ path }) => path));
  return unrecordedFolders(paths, recordedPaths).map((path) => ({ path, reason: 'unrecorded' }));
}

/** The listed folder paths that hold something the plugin's file does not record. */
function unrecordedFolders(paths: readonly string[], recordedPaths: ReadonlySet<string>): string[] {
  return paths.filter((path) => !recordedPaths.has(path) && exists(path));
}

/** What an install will do, written as the pending plugin's file before it touches any target. */
interface InstallPlan {
  readonly pending: Pending;
  readonly created: readonly string[];
  readonly removals: readonly CommittedFile[];
  readonly folderRemovals: readonly RecordedFolder[];
  readonly replaced: readonly string[];
  readonly committed: Committed;
}

/**
 * The plan for the targets it writes, with no folder taken over yet. The pending file lists
 * every folder recorded before and every folder listed now, so a folder stays recorded wherever a
 * kill leaves the install.
 */
function planInstall(
  targets: readonly { file: InstalledFile; prior: string | null }[],
  folders: readonly InstalledFolder[],
  committed: Committed,
): InstallPlan {
  const listed = new Set(targets.map(({ file }) => file.path));
  const listedFolders = new Set(folders.map(({ path }) => path));
  const created = [
    ...new Set(
      [...targets.map(({ file }) => file.path), ...folders.map(({ path }) => path)].flatMap(
        missingParents,
      ),
    ),
  ];
  const directories = [...new Set([...committed.directories, ...created])];
  const removals = committed.files.filter(({ path }) => !listed.has(path));
  const written = targets.map(({ file, prior }) => ({
    intended: digestOf(file.content),
    path: file.path,
    prior,
  }));
  const pendingFiles: PendingFile[] = [
    ...written,
    ...removals.map(({ digest, path }) => ({ intended: null, path, prior: digest })),
  ];
  const folderRemovals = committed.folders.filter(({ path }) => !listedFolders.has(path));
  const everyFolder = [
    ...committed.folders,
    ...folders.filter(({ path }) => !committed.folders.some((entry) => entry.path === path)),
  ].map(({ path }) => ({ path }));
  return {
    committed: {
      directories,
      files: written.map(({ intended, path }) => ({ digest: intended, path })),
      folders: folders.map(({ path }) => ({ path })),
      state: 'committed',
    },
    created,
    folderRemovals,
    pending: { directories, files: pendingFiles, folders: everyFolder, state: 'pending' },
    removals,
    replaced: [],
  };
}

/**
 * What an install lists: its files, its folders, whether it may take over an unrecorded folder,
 * and the mode it creates missing parent directories with, when it names one.
 */
interface Listed {
  readonly files: readonly InstalledFile[];
  readonly folders: readonly InstalledFolder[];
  readonly force: boolean;
  readonly directoryMode: number | undefined;
}

/** The rule a target path breaks, or none for an absolute, normalized path not yet listed. */
function targetPathFault(path: string, listed: ReadonlySet<string>): string | undefined {
  if (!isAbsolute(path)) {
    return 'is not absolute';
  }
  if (path !== normalize(path) || path.endsWith(sep)) {
    return 'is not normalized';
  }
  return listed.has(path) ? 'is listed twice' : undefined;
}

/**
 * The rule a file of a folder breaks, or none for a relative POSIX path that is normalized, stays
 * inside the folder, and is not yet listed.
 */
function folderFilePathFault(path: string, listed: ReadonlySet<string>): string | undefined {
  if (isAbsolute(path) || path === '' || path.endsWith(posix.sep)) {
    return 'is not relative';
  }
  if (path !== posix.normalize(path) || path === '..' || path.startsWith(`..${posix.sep}`)) {
    return 'is not normalized or leaves its folder';
  }
  return listed.has(path) ? 'is listed twice' : undefined;
}

/** Throws a TypeError for the first file of a folder whose path breaks the rule above. */
function checkFolderFilePaths(folder: InstalledFolder): void {
  const listed = new Set<string>();
  for (const { path } of folder.files) {
    const fault = folderFilePathFault(path, listed);
    if (fault !== undefined) {
      throw new TypeError(`Installed folder file path "${path}" in "${folder.path}" ${fault}.`);
    }
    listed.add(path);
  }
}

/**
 * Throws a TypeError for the first target path, of a file or a folder, that is not absolute, not
 * normalized, or listed twice, and for the first file of a folder whose path is not relative and
 * normalized: a first-party plugin's bug, which the module never repairs by normalizing or merging.
 */
function checkTargetPaths(
  files: readonly InstalledFile[],
  folders: readonly InstalledFolder[],
): void {
  const listed = new Set<string>();
  const kinds = [
    ...files.map(({ path }) => ({ kind: 'file', path })),
    ...folders.map(({ path }) => ({ kind: 'folder', path })),
  ];
  for (const { kind, path } of kinds) {
    const fault = targetPathFault(path, listed);
    if (fault !== undefined) {
      throw new TypeError(`Installed ${kind} path "${path}" ${fault}.`);
    }
    listed.add(path);
  }
  folders.forEach(checkFolderFilePaths);
}

/**
 * Installs the plugin's files and folders. A target path that is not absolute, not normalized, or
 * listed twice throws a TypeError before anything is read or written. It recovers a pending
 * plugin's file first, then checks every target: a file target that is absent, or a regular file
 * the plugin recorded with its digest unchanged, may be written, and a folder target that is
 * absent or recorded may be replaced whatever is inside it. Any other target refuses the whole
 * install, which writes nothing, except an unrecorded folder target under the force mode, which is
 * replaced and recorded. It reads the run signal before the pending write and, once it has begun,
 * does not stop between targets. Each file goes through a staging file and a rename, each folder
 * through a staging folder and renames, and each recorded file the install no longer lists is
 * removed when no one changed it, and each recorded folder it no longer lists is removed whole.
 */
function install(request: InstallRequest): InstallOutcome {
  const listed: Listed = {
    directoryMode: request.directoryMode,
    files: request.files,
    folders: request.folders ?? [],
    force: request.force === true,
  };
  checkTargetPaths(listed.files, listed.folders);
  const path = pluginFilePath(request.record, request.plugin);
  const prepared = prepareInstall(path, listed);
  if ('refused' in prepared) {
    return { refused: prepared.refused, status: 'refused' };
  }
  request.signal.throwIfAborted();
  return carryOut(path, prepared.plan, listed);
}

/** The refusals of the file targets against the files the plugin's file records. */
function fileRefusals(
  observed: readonly { file: InstalledFile; seen: Observed }[],
  committed: Committed,
): Refusal[] {
  const digests = new Map(committed.files.map(({ digest, path }) => [path, digest]));
  return observed.flatMap(({ file, seen }) => refusalOf(file.path, seen, digests));
}

/** Each observed file target with the digest it held before, `null` when it held nothing. */
function withPriors(
  observed: readonly { file: InstalledFile; seen: Observed }[],
): { file: InstalledFile; prior: string | null }[] {
  return observed.map(({ file, seen }) => ({
    file,
    prior: seen.kind === 'file' ? seen.digest : null,
  }));
}

/**
 * Everything an install reads before it writes: the plugin's file, recovered when pending, and
 * every target. It answers each path that refuses the install, or the plan it carries out.
 */
function prepareInstall(
  path: string,
  listed: Listed,
): { readonly refused: readonly Refusal[] } | { readonly plan: InstallPlan } {
  const found = recorded(path);
  if ('refused' in found) {
    return { refused: [found.refused] };
  }
  const observed = listed.files.map((file) => ({ file, seen: observe(file.path) }));
  const unrecorded = folderRefusals(
    listed.folders.map((folder) => folder.path),
    found.committed.folders,
  );
  const refused = [...fileRefusals(observed, found.committed), ...(listed.force ? [] : unrecorded)];
  if (refused.length !== EMPTY) {
    return { refused };
  }
  const replaced = unrecorded.map((refusal) => refusal.path);
  return {
    plan: { ...planInstall(withPriors(observed), listed.folders, found.committed), replaced },
  };
}

/** The writes of the files and folders, in that order, after the missing parents are created. */
function writeTargets(plan: InstallPlan, listed: Listed): void {
  for (const directory of plan.created) {
    createDirectory(directory, listed.directoryMode);
  }
  for (const file of listed.files) {
    replaceFile(file.path, file.content, file.mode === undefined ? {} : { mode: file.mode });
  }
  for (const folder of listed.folders) {
    writeFolder(folder.path, folder.files);
  }
}

/** The writes of an install, which do not stop between targets once the pending file is written. */
function carryOut(path: string, plan: InstallPlan, listed: Listed): InstallOutcome {
  writePluginFile(path, plan.pending);
  writeTargets(plan, listed);
  const { kept, removed } = removeRecorded(plan.removals);
  const removedFolders = removeFolders(plan.folderRemovals);
  writePluginFile(path, plan.committed);
  return {
    kept,
    removed: [...removed, ...removedFolders],
    status: 'installed',
    written: [...listed.files, ...listed.folders].map((target) => target.path),
    ...(plan.replaced.length === EMPTY ? {} : { replaced: plan.replaced }),
  };
}

/** Removes each recorded folder whole and answers those that were there; a folder already gone is no error. */
function removeFolders(folders: readonly RecordedFolder[]): string[] {
  return folders.filter(({ path }) => removeWhole(path)).map(({ path }) => path);
}

/** Removes each recorded directory that is empty, deepest first, so a parent empties before its turn. */
function removeDirectories(directories: readonly string[]): void {
  // The pack's ES2022 library has no toSorted, and this sorts a copy the call owns.
  // oxlint-disable-next-line unicorn/no-array-sort
  const deepestFirst = [...directories].sort((first, second) => second.length - first.length);
  for (const directory of deepestFirst) {
    removeEmptyDirectory(directory);
  }
}

/**
 * Uninstalls the plugin's files and folders. It recovers a pending plugin's file first, removes each
 * recorded file whose digest is unchanged, keeps each one someone changed, removes each recorded
 * folder whole, removes each recorded directory that is then empty, deepest first, and deletes the
 * plugin's file. It reads the run signal before the first removal. A path already gone is no error.
 */
function uninstall(request: UninstallRequest): UninstallOutcome {
  const path = pluginFilePath(request.record, request.plugin);
  const found = recorded(path);
  if ('refused' in found) {
    return { refused: [found.refused], status: 'refused' };
  }
  request.signal.throwIfAborted();
  const { kept, removed } = removeRecorded(found.committed.files);
  const removedFolders = removeFolders(found.committed.folders);
  removeDirectories(found.committed.directories);
  rmSync(path, { force: true });
  return { kept, removed: [...removed, ...removedFolders], status: 'uninstalled' };
}

/**
 * What a plugin's file records, read without writing: its files and, when it records any, its
 * folders, or the refusal of its file.
 */
type RecordedRead =
  | { readonly status: 'refused'; readonly refused: Refusal<RecordRefusalReason> }
  | {
      readonly status: 'read';
      readonly files: readonly CommittedFile[];
      readonly folders?: readonly RecordedFolder[];
    };

/**
 * What the plugin's file records, read without writing anything: each recorded file with its
 * digest and each recorded folder, none for a missing file, and for a pending file what recovery
 * would keep. A damaged file or one of an unknown format refuses, as it refuses an install or
 * uninstall.
 */
function readRecorded(request: Omit<UninstallRequest, 'signal'>): RecordedRead {
  const path = pluginFilePath(request.record, request.plugin);
  const read = readPluginFile(path);
  if (read.kind === 'refused') {
    return { refused: { path, reason: read.reason }, status: 'refused' };
  }
  if (read.kind === 'missing') {
    return { files: [], status: 'read' };
  }
  const { file } = read;
  return {
    files: file.state === 'pending' ? file.files.flatMap(recoveredFile) : file.files,
    ...(file.folders.length === EMPTY ? {} : { folders: file.folders }),
    status: 'read',
  };
}

/**
 * Whether the plugin's file is `pending`, which an install or uninstall resolves before it acts,
 * read without writing. A missing, damaged, or unknown file is not pending.
 */
function hasPendingRecord(request: Omit<UninstallRequest, 'signal'>): boolean {
  const read = readPluginFile(pluginFilePath(request.record, request.plugin));
  return read.kind === 'read' && read.file.state === 'pending';
}

/**
 * The refusal each target path would meet from an install against the recorded files, read
 * without writing: none for an absent target or a recorded file with its digest unchanged.
 */
function targetRefusals(
  paths: readonly string[],
  files: readonly CommittedFile[],
): readonly Refusal[] {
  const digests = new Map(files.map(({ digest, path }) => [path, digest]));
  return paths.flatMap((path) => refusalOf(path, observe(path), digests));
}

export type {
  InstalledFile,
  InstalledFolder,
  InstallOutcome,
  InstallRequest,
  RecordedRead,
  RecordRefusalReason,
  Refusal,
  RefusalReason,
  UninstallOutcome,
  UninstallRequest,
};
export { folderRefusals, hasPendingRecord, install, readRecorded, targetRefusals, uninstall };
