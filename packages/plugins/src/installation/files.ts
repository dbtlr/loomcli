/**
 * The installed-files module the first-party plugins that install files outside the application
 * share, such as a completion script, a manual page, an agent skill, or a service unit. Each plugin
 * records what it wrote in its own file in the installation record, `<plugin>.json`, and never takes
 * over a file it did not record. The module is internal to the pack: no subpath exports it.
 */
import { rmSync } from 'node:fs';
import { isAbsolute, normalize, sep } from 'node:path';

import {
  createDirectory,
  digestOf,
  missingParents,
  observe,
  removeEmptyDirectory,
  removeStagingFiles,
  replaceFile,
} from './disk.js';
import type { Observed } from './disk.js';
import { nothingRecorded, pluginFilePath, readPluginFile, writePluginFile } from './record.js';
import type { Committed, CommittedFile, Pending, PendingFile } from './record.js';

/** One file an install writes: its absolute path and the content it will hold. */
interface InstalledFile {
  readonly path: string;
  readonly content: string | Uint8Array;
}

/**
 * Why a path refuses an install or uninstall: a file the plugin did not record, a recorded file
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
      readonly written: readonly string[];
      /** Recorded files the install no longer lists, removed because no one changed them. */
      readonly removed: readonly string[];
      /** Recorded files the install no longer lists, kept because someone changed them. */
      readonly kept: readonly string[];
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

interface InstallRequest extends UninstallRequest {
  readonly files: readonly InstalledFile[];
}

/**
 * Resolves a pending plugin's file by what is on disk: a path holding the intended or the prior
 * digest stays recorded with it, and one that is gone or holds any other digest is dropped. A
 * listed directory that exists stays. Leftover staging files are removed, and the result is
 * written as committed.
 */
function recover(path: string, pending: Pending): Committed {
  for (const entry of pending.files) {
    removeStagingFiles(entry.path);
  }
  const committed: Committed = {
    directories: pending.directories.filter((directory) => observe(directory).kind === 'directory'),
    files: pending.files.flatMap(recoveredFile),
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

/** What an install will do, written as the pending plugin's file before it touches any target. */
interface InstallPlan {
  readonly pending: Pending;
  readonly created: readonly string[];
  readonly removals: readonly CommittedFile[];
  readonly committed: Committed;
}

function planInstall(
  targets: readonly { file: InstalledFile; prior: string | null }[],
  committed: Committed,
): InstallPlan {
  const listed = new Set(targets.map(({ file }) => file.path));
  const created = [...new Set(targets.flatMap(({ file }) => missingParents(file.path)))];
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
  return {
    committed: {
      directories,
      files: written.map(({ intended, path }) => ({ digest: intended, path })),
      state: 'committed',
    },
    created,
    pending: { directories, files: pendingFiles, state: 'pending' },
    removals,
  };
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
 * Throws a TypeError for the first target path that is not absolute, not normalized, or listed
 * twice: a first-party plugin's bug, which the module never repairs by normalizing or merging.
 */
function checkTargetPaths(files: readonly InstalledFile[]): void {
  const listed = new Set<string>();
  for (const { path } of files) {
    const fault = targetPathFault(path, listed);
    if (fault !== undefined) {
      throw new TypeError(`Installed file path "${path}" ${fault}.`);
    }
    listed.add(path);
  }
}

/**
 * Installs the plugin's files. A target path that is not absolute, not normalized, or listed twice
 * throws a TypeError before anything is read or written. It recovers a pending plugin's file first, then checks every
 * target: a target that is absent, or a regular file the plugin recorded with its digest
 * unchanged, may be written, and any other refuses the whole install, which writes nothing. It
 * reads the run signal before the pending write and, once it has begun, does not stop between
 * targets. Each target goes through a staging file and a rename, and each recorded file the
 * install no longer lists is removed when no one changed it.
 */
function install(request: InstallRequest): InstallOutcome {
  checkTargetPaths(request.files);
  const path = pluginFilePath(request.record, request.plugin);
  const prepared = prepareInstall(path, request.files);
  if ('refused' in prepared) {
    return { refused: prepared.refused, status: 'refused' };
  }
  request.signal.throwIfAborted();
  return carryOut(path, prepared.plan, request.files);
}

/**
 * Everything an install reads before it writes: the plugin's file, recovered when pending, and
 * every target. It answers each path that refuses the install, or the plan it carries out.
 */
function prepareInstall(
  path: string,
  files: readonly InstalledFile[],
): { readonly refused: readonly Refusal[] } | { readonly plan: InstallPlan } {
  const found = recorded(path);
  if ('refused' in found) {
    return { refused: [found.refused] };
  }
  const digests = new Map(found.committed.files.map(({ digest, path: file }) => [file, digest]));
  const observed = files.map((file) => ({ file, seen: observe(file.path) }));
  const refused = observed.flatMap(({ file, seen }) => refusalOf(file.path, seen, digests));
  if (refused.length !== EMPTY) {
    return { refused };
  }
  const targets = observed.map(({ file, seen }) => ({
    file,
    prior: seen.kind === 'file' ? seen.digest : null,
  }));
  return { plan: planInstall(targets, found.committed) };
}

/** The writes of an install, which do not stop between targets once the pending file is written. */
function carryOut(
  path: string,
  plan: InstallPlan,
  files: readonly InstalledFile[],
): InstallOutcome {
  writePluginFile(path, plan.pending);
  for (const directory of plan.created) {
    createDirectory(directory);
  }
  for (const file of files) {
    replaceFile(file.path, file.content);
  }
  const { kept, removed } = removeRecorded(plan.removals);
  writePluginFile(path, plan.committed);
  return { kept, removed, status: 'installed', written: files.map((file) => file.path) };
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
 * Uninstalls the plugin's files. It recovers a pending plugin's file first, removes each recorded
 * file whose digest is unchanged, keeps each one someone changed, removes each recorded directory
 * that is then empty, deepest first, and deletes the plugin's file. It reads the run signal before
 * the first removal. A path already gone is no error.
 */
function uninstall(request: UninstallRequest): UninstallOutcome {
  const path = pluginFilePath(request.record, request.plugin);
  const found = recorded(path);
  if ('refused' in found) {
    return { refused: [found.refused], status: 'refused' };
  }
  request.signal.throwIfAborted();
  const { kept, removed } = removeRecorded(found.committed.files);
  removeDirectories(found.committed.directories);
  rmSync(path, { force: true });
  removeStagingFiles(path);
  return { kept, removed, status: 'uninstalled' };
}

export type {
  InstalledFile,
  InstallOutcome,
  InstallRequest,
  RecordRefusalReason,
  Refusal,
  RefusalReason,
  UninstallOutcome,
  UninstallRequest,
};
export { install, uninstall };
