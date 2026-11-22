/**
 * The installed-files module the first-party plugins that install files outside the application
 * share, such as a completion script, a manual page, an agent skill, or a service unit, and the
 * startup lines that load one. Each plugin records what it wrote in its own file in the
 * installation record, `<plugin>.json`, and never takes over a file it did not record; a startup
 * file is the operator's, and the module changes only the lines it records there. The MCP plugin
 * records a registration an agent's own CLI holds in its file instead of a file or a line, and the
 * module writes that file pending before the agent's call and committed after it. The module is
 * internal to the pack: no subpath exports it.
 */
import { rmSync } from 'node:fs';

import type { Log } from '@loomcli/core';

import { fileRemoved, fileWritten } from '../change-events.js';
import {
  checkEmptiable,
  checkWritable,
  createDirectory,
  digestOf,
  exists,
  folderLeftovers,
  lstatIfPresent,
  missingParents,
  observe,
  recordLeftovers,
  removeEmptyDirectory,
  removeStagingFiles,
  replaceFile,
} from './disk.js';
import type { Observed } from './disk.js';
import {
  changedReferences,
  folderDigests,
  recoveredFolder,
  removeFolderLeftovers,
  removeWhole,
  writeFolder,
} from './folders.js';
import type { FolderFile } from './folders.js';
import {
  applyLine,
  committedOf,
  createdParentsOf,
  heldLine,
  outcomeOf,
  pendingOf,
  planLines,
  removeLineLeftovers,
  unlistedActions,
} from './lines.js';
import type { InstalledLine, LineAction, LineListing, StartupLinesOutcome } from './lines.js';
import { writing } from './reach.js';
import { nothingRecorded, pluginFilePath, readPluginFile, writePluginFile } from './record.js';
import type {
  Committed,
  CommittedFile,
  Pending,
  PendingFile,
  PendingFolder,
  PendingRegistration,
  PluginFileRead,
  RecordedFolder,
  RecordedRegistration,
  StartupLine,
} from './record.js';

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

/** A refused installed file or record, or a folder with a changed generated reference. */
type Refusal<Reason extends RefusalReason = RefusalReason> =
  | { readonly path: string; readonly reason: Reason }
  | ('changed' extends Reason ? ChangedFolder : never);

/** A folder refused because a generated reference changed. */
interface ChangedFolder {
  readonly path: string;
  readonly reason: 'changed';
  /** The required relative path of the changed generated reference. */
  readonly file: string;
}

/** The two refusal shapes a listed folder can produce. */
type FolderRefusal = ChangedFolder | { readonly path: string; readonly reason: 'unrecorded' };

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
      /** What happened to each startup line listed, recorded, or released; absent when there was none. */
      readonly lines?: StartupLinesOutcome;
    };

/** What happened to each recorded startup line in an uninstall: removed, no longer held, or released. */
type UninstalledLines = Pick<StartupLinesOutcome, 'removed' | 'noLongerHeld' | 'released'>;

type UninstallOutcome =
  | { readonly status: 'refused'; readonly refused: readonly Refusal<RecordRefusalReason>[] }
  | {
      readonly status: 'uninstalled';
      readonly removed: readonly string[];
      readonly kept: readonly string[];
      /** What happened to each recorded startup line; absent when the plugin's file records none. */
      readonly lines?: UninstalledLines;
    };

const EMPTY = 0;

/** Whose files: the record directory, which the caller resolves, and the plugin. */
interface RecordRequest {
  readonly record: string;
  readonly plugin: string;
}

/**
 * Whose files, and the run's log, which records a change event for each file the module writes or
 * removes, under ADR-0165.
 */
interface RecordChange extends RecordRequest {
  readonly log: Log;
}

/**
 * Whose files, the run's log and signal, and the startup files whose recorded lines the plugin
 * releases because it cannot change them: each is dropped from the plugin's file and reported, and
 * its startup file is neither read nor written.
 */
interface UninstallRequest extends RecordChange {
  readonly signal: AbortSignal;
  readonly release?: readonly string[];
}

/** Writes the plugin's file and records the write. */
function writeRecordFile(path: string, file: Committed | Pending, log: Log): void {
  writePluginFile(path, file);
  fileWritten(log, { path });
}

/**
 * Deletes a file when it is there and records the removal; one already gone records nothing. A
 * removal its folder refuses fails naming the path.
 */
function removeIfPresent(path: string, log: Log): void {
  if (exists(path)) {
    writing(path, () => {
      rmSync(path, { force: true });
    });
    fileRemoved(log, { path });
  }
}

/**
 * What an install writes: files, folders, startup lines, or any of them. The force mode, which only
 * the skills plugin passes, replaces an unrecorded folder at a listed folder's path in place of
 * refusing. An update adds no recorded line its startup file no longer holds, and drops it from the
 * plugin's file. The directory mode is the permission bits of each directory the install creates,
 * whatever the umask. Each target path is absolute and normalized, and each startup line one line
 * of text, as the first-party plugins that call the module build them.
 */
interface InstallRequest extends UninstallRequest {
  readonly files: readonly InstalledFile[];
  readonly folders?: readonly InstalledFolder[];
  readonly force?: boolean;
  readonly lines?: readonly InstalledLine[];
  readonly update?: boolean;
  readonly directoryMode?: number;
}

/**
 * What a pending plugin's file resolves to by what is on disk, read without writing: a path holding
 * the intended or the prior digest stays recorded with it, and one that is gone or holds any other
 * digest is dropped. A listed directory that exists stays. Each folder keeps its intended files when
 * they match, or its prior files when something is at its path, including a prior path-only record.
 * A pending startup line keeps the intended text or the prior one, whichever its file holds, or no
 * line.
 */
function recoveredOf(pending: Pending): Committed {
  return {
    directories: pending.directories.filter((directory) => observe(directory).kind === 'directory'),
    files: pending.files.flatMap(recoveredFile),
    folders: pending.folders.flatMap(recoveredFolder),
    lines: pending.lines.flatMap(heldLine),
    registrations: pending.registrations.flatMap(recoveredRegistration),
    state: 'committed',
  };
}

/**
 * Removes what a run a pending plugin's file records left behind: leftover staging files, of
 * targets and of startup files, and the staging and retired folders beside each listed folder, each
 * recorded as removed.
 */
function removeRecoveryLeftovers(pending: Pending, log: Log): void {
  for (const entry of pending.files) {
    recordLeftovers(log, removeStagingFiles(entry.path));
  }
  for (const folder of pending.folders) {
    recordLeftovers(log, removeFolderLeftovers(folder.path));
  }
  for (const entry of pending.lines) {
    removeLineLeftovers(entry, log);
  }
}

/**
 * A pending registration resolved without reading the agent: the command line it intended, or the
 * one it held before when it was being removed, and none when that is `null` too.
 */
function recoveredRegistration(entry: PendingRegistration): RecordedRegistration[] {
  const command = entry.intended ?? entry.prior;
  return command === null ? [] : [{ command, name: entry.name }];
}

function recoveredFile(entry: PendingFile): CommittedFile[] {
  const seen = observe(entry.path);
  if (seen.kind !== 'file' || (seen.digest !== entry.intended && seen.digest !== entry.prior)) {
    return [];
  }
  return [{ digest: seen.digest, path: entry.path }];
}

/**
 * Reads the plugin's file and then every file, folder, and directory it records, so a recorded path
 * where a file sits in place of one of its folders fails the read, naming that path, before the run
 * changes anything. Read as gone, such a path would drop from the record while the folder that
 * holds it may come back.
 */
function readReachable(path: string): PluginFileRead {
  const read = readPluginFile(path);
  if (read.kind === 'read') {
    const { directories, files, folders } = read.file;
    for (const recordedPath of [
      ...files.map((entry) => entry.path),
      ...folders.map((entry) => entry.path),
      ...directories,
    ]) {
      lstatIfPresent(recordedPath);
    }
  }
  return read;
}

/**
 * The plugin's file as a run found it, read without writing: its path, what it holds, a missing one
 * holding nothing, and what it records, a pending one as recovery would resolve it.
 */
interface Found {
  readonly path: string;
  readonly read: Exclude<PluginFileRead, { readonly kind: 'refused' }>;
  readonly committed: Committed;
}

/**
 * Reads the plugin's file and every path it records without writing, or answers the refusal of a
 * file the module cannot read. For a pending file, which every run that examines it recovers before
 * it acts, it also checks that the run's user may empty each leftover staging and retired folder
 * beside each folder the file names, so a leftover recovery could not remove fails the run naming
 * the directory in it that refuses, before the run changes anything.
 */
function examine(path: string): Found | { readonly refused: Refusal<RecordRefusalReason> } {
  const read = readReachable(path);
  if (read.kind === 'refused') {
    return { refused: { path, reason: read.reason } };
  }
  if (read.kind === 'missing') {
    return { committed: nothingRecorded, path, read };
  }
  if (read.file.state === 'pending') {
    checkEmptiable(read.file.folders.flatMap((folder) => folderLeftovers(folder.path)));
    return { committed: recoveredOf(read.file), path, read };
  }
  return { committed: read.file, path, read };
}

/**
 * The changes a run makes to its plugin's file before it acts, once every read and check passed:
 * the file's leftover staging files removed, and a pending file recovered, its stopped run's
 * leftovers removed and the resolution `recoveredOf` read written as committed.
 */
function settle({ committed, path, read }: Found, log: Log): void {
  recordLeftovers(log, removeStagingFiles(path));
  if (read.kind === 'read' && read.file.state === 'pending') {
    removeRecoveryLeftovers(read.file, log);
    writeRecordFile(path, committed, log);
  }
}

/** The plugin's file as `examine` found it when it is there and readable, and none otherwise. */
function examineRecorded(path: string): Found | undefined {
  const found = examine(path);
  return 'refused' in found || found.read.kind === 'missing' ? undefined : found;
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

/**
 * What a run will do to the recorded files and folders it removes, read before it changes anything:
 * the files and the folders it removes, those it keeps because someone changed them, and none of
 * those already gone.
 */
interface Removals {
  readonly files: readonly string[];
  readonly folders: readonly string[];
  readonly kept: readonly string[];
}

/**
 * Reads every recorded file and folder a run removes before it removes any, so a file the run
 * cannot read fails the run with nothing removed: a file whose digest is unchanged and an unchanged
 * folder that is there are removed, each one someone changed is kept, and one that is gone is
 * passed over.
 */
function judgeRemovals(
  files: readonly CommittedFile[],
  folders: readonly RecordedFolder[],
): Removals {
  const seenFiles = files.map((file) => ({ ...file, seen: observe(file.path) }));
  const changedFolders = folders.map((folder) => ({
    changed: changedReferences(folder).length > EMPTY,
    path: folder.path,
  }));
  return {
    files: seenFiles
      .filter(({ digest, seen }) => seen.kind === 'file' && seen.digest === digest)
      .map(({ path }) => path),
    folders: changedFolders
      .filter(({ changed, path }) => !changed && exists(path))
      .map(({ path }) => path),
    kept: [
      ...seenFiles
        .filter(
          ({ digest, seen }) =>
            seen.kind !== 'absent' && !(seen.kind === 'file' && seen.digest === digest),
        )
        .map(({ path }) => path),
      ...changedFolders.filter(({ changed }) => changed).map(({ path }) => path),
    ],
  };
}

/**
 * Removes the files and folders `judgeRemovals` chose, files first, recording each removal as it is
 * made. A removal its folder refuses fails naming the path.
 */
function applyRemovals(removals: Removals, log: Log): { removed: string[]; kept: string[] } {
  for (const path of removals.files) {
    writing(path, () => {
      rmSync(path);
    });
    fileRemoved(log, { path });
  }
  for (const path of removals.folders) {
    writing(path, () => removeWhole(path));
    fileRemoved(log, { path });
  }
  return { kept: [...removals.kept], removed: [...removals.files, ...removals.folders] };
}

/** Each unrecorded listed folder, and each changed generated file in a listed recorded folder. */
function folderRefusals(
  paths: readonly string[],
  folders: readonly RecordedFolder[],
): readonly FolderRefusal[] {
  const recordedPaths = new Set(folders.map(({ path }) => path));
  return [
    ...unrecordedFolders(paths, recordedPaths).map((path): FolderRefusal => ({
      path,
      reason: 'unrecorded',
    })),
    ...folders
      .filter((folder) => paths.includes(folder.path))
      .flatMap((folder): FolderRefusal[] =>
        changedReferences(folder).map((file) => ({ file, path: folder.path, reason: 'changed' })),
      ),
  ];
}

/** The listed folder paths that hold something the plugin's file does not record. */
function unrecordedFolders(paths: readonly string[], recordedPaths: ReadonlySet<string>): string[] {
  return paths.filter((path) => !recordedPaths.has(path) && exists(path));
}

/** What an install will do, written as the pending plugin's file before it touches any target. */
interface InstallPlan {
  readonly pending: Pending;
  readonly created: readonly string[];
  /** The listed files already there with the digest the install would write, which it leaves in place. */
  readonly unchanged: ReadonlySet<string>;
  readonly removals: readonly CommittedFile[];
  readonly folderRemovals: readonly RecordedFolder[];
  readonly replaced: readonly string[];
  readonly lines: readonly LineAction[];
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
  ].map(({ path }): PendingFolder => ({
    intended:
      folders.find((folder) => folder.path === path)?.files === undefined
        ? null
        : folderDigests(folders.find((folder) => folder.path === path)?.files ?? []),
    path,
    prior:
      committed.folders.find((folder) => folder.path === path)?.files ??
      (committed.folders.some((folder) => folder.path === path) ? 'path' : null),
  }));
  return {
    committed: {
      directories,
      files: written.map(({ intended, path }) => ({ digest: intended, path })),
      folders: folders.map(({ path, files }) => ({ files: folderDigests(files), path })),
      lines: [],
      registrations: [],
      state: 'committed',
    },
    created,
    folderRemovals,
    lines: [],
    pending: {
      directories,
      files: pendingFiles,
      folders: everyFolder,
      lines: [],
      registrations: [],
      state: 'pending',
    },
    removals,
    replaced: [],
    unchanged: new Set(
      written.filter(({ intended, prior }) => prior === intended).map(({ path }) => path),
    ),
  };
}

/**
 * The plan with the startup lines' actions added: each pending and committed line, and each missing
 * directory above a startup file the install creates, recorded as a directory it created.
 */
function withLines(plan: InstallPlan, actions: readonly LineAction[]): InstallPlan {
  const created = [...new Set([...plan.created, ...actions.flatMap(createdParentsOf)])];
  const directories = [...new Set([...plan.committed.directories, ...created])];
  return {
    ...plan,
    committed: { ...plan.committed, directories, lines: actions.flatMap(committedOf) },
    created,
    lines: actions,
    pending: { ...plan.pending, directories, lines: actions.flatMap(pendingOf) },
  };
}

/**
 * What an install lists: its files, its folders, whether it may take over an unrecorded folder, its
 * startup lines with the releases and the update mark, and the mode of the directories it creates.
 */
interface Listed {
  readonly files: readonly InstalledFile[];
  readonly folders: readonly InstalledFolder[];
  readonly force: boolean;
  readonly lines: LineListing;
  readonly directoryMode: number | undefined;
}

/**
 * Installs the plugin's files and folders. It reads the plugin's file and every target first: a
 * file target that is absent, or a regular file the plugin recorded with its digest unchanged, may
 * be written. An absent folder or a recorded folder with no changed references may be replaced. An
 * unrecorded or modified folder refuses the whole install unless force takes it over. It reads
 * every recorded file and folder it would remove, and checks that it may write the plugin's file
 * and every target, remove every file it would remove, and empty every folder it would replace or
 * remove and every leftover folder a write or recovery removes, so a path it cannot reach or write
 * fails the run before it changes anything. Then it removes the plugin's file's leftover staging files and recovers a
 * pending plugin's file. It reads the run signal before the pending write and, once it has begun,
 * does not stop between targets. Each file goes through a staging file and a rename, unless it is
 * already there with the digest it would be written with, each folder through a staging folder and
 * renames, and each recorded file the install no longer lists is removed when no one changed it,
 * and each recorded folder it no longer lists is removed whole unless its references changed, in
 * which case it is kept. Each listed startup line is added, recorded as held, or replaced where it
 * stands. Each recorded line it no longer lists is removed, and each released line is dropped, as
 * Installed files states.
 */
function install(request: InstallRequest): InstallOutcome {
  const listed = listedOf(request);
  const path = pluginFilePath(request.record, request.plugin);
  const prepared = prepareInstall(path, listed);
  if ('refused' in prepared) {
    if (prepared.found !== undefined) {
      settle(prepared.found, request.log);
    }
    return { refused: prepared.refused, status: 'refused' };
  }
  settle(prepared.found, request.log);
  request.signal.throwIfAborted();
  return carryOut(path, prepared.plan, {
    listed,
    log: request.log,
    removals: prepared.removals,
  });
}

/**
 * Makes every read and check an install makes before it changes anything, and changes nothing: a
 * plugin that installs into several targets checks each before it installs any, so a path one
 * target cannot reach or write fails the run with no target changed. A refusal is left to the
 * install, which reports it.
 */
function checkInstall(request: Omit<InstallRequest, 'log' | 'signal'>): void {
  const listed = listedOf(request);
  prepareInstall(pluginFilePath(request.record, request.plugin), listed);
}

/** What an install request lists, each list it leaves out empty, with its releases and update mark. */
function listedOf(request: Omit<InstallRequest, 'log' | 'signal'>): Listed {
  return {
    directoryMode: request.directoryMode,
    files: request.files,
    folders: request.folders ?? [],
    force: request.force === true,
    lines: {
      lines: request.lines ?? [],
      release: new Set(request.release),
      update: request.update === true,
    },
  };
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
 * Every target an install lists, read against what the plugin's file records: each file observed,
 * the refusals of every kind of target, the unrecorded or modified folders the force mode takes
 * over, and what the install does to each startup line.
 */
function readTargets(listed: Listed, committed: Committed) {
  const observed = listed.files.map((file) => ({ file, seen: observe(file.path) }));
  const unrecorded = folderRefusals(
    listed.folders.map((folder) => folder.path),
    committed.folders,
  );
  const lines = planLines(listed.lines, committed.lines);
  const refused = [
    ...fileRefusals(observed, committed),
    ...(listed.force ? [] : unrecorded),
    ...lines.refused,
  ];
  return {
    lines: lines.actions,
    observed,
    refused,
    replaced: [...new Set(unrecorded.map(({ path }) => path))],
  };
}

/**
 * Checks that an install may write the plugin's file at `path`, every target it writes, and every
 * file and folder it removes, and may empty every folder it replaces or removes and every leftover
 * staging and retired folder beside a folder it writes, which the write removes first.
 */
function checkInstallWrites(
  path: string,
  listed: Listed,
  { removals, unchanged }: { readonly removals: Removals; readonly unchanged: ReadonlySet<string> },
): void {
  const folders = listed.folders.map((folder) => folder.path);
  checkWritable([
    path,
    ...listed.files.map((file) => file.path).filter((target) => !unchanged.has(target)),
    ...folders,
    ...removals.files,
    ...removals.folders,
  ]);
  checkEmptiable([...folders, ...removals.folders, ...folders.flatMap(folderLeftovers)]);
}

/**
 * Everything an install reads and checks before it writes, without changing anything: the plugin's
 * file, resolved as recovery would resolve it when pending, every target, every startup file it
 * would change, and every recorded file and folder it would remove, and then whether it may write
 * the plugin's file and every target, remove every file it would remove, and empty every folder it
 * would replace or remove. It answers each path that refuses the install, with the plugin's file
 * when it could read it, or the plan it carries out.
 */
function prepareInstall(
  path: string,
  listed: Listed,
):
  | { readonly refused: readonly Refusal[]; readonly found?: Found }
  | { readonly plan: InstallPlan; readonly removals: Removals; readonly found: Found } {
  const found = examine(path);
  if ('refused' in found) {
    return { refused: [found.refused] };
  }
  const targets = readTargets(listed, found.committed);
  if (targets.refused.length !== EMPTY) {
    return { found, refused: targets.refused };
  }
  const plan = planInstall(withPriors(targets.observed), listed.folders, found.committed);
  const removals = judgeRemovals(plan.removals, plan.folderRemovals);
  checkInstallWrites(path, listed, { removals, unchanged: plan.unchanged });
  return {
    found,
    plan: withLines({ ...plan, replaced: targets.replaced }, targets.lines),
    removals,
  };
}

/**
 * The writes of the files, folders, and startup lines, in that order, after the missing parents are
 * created with the directory mode the plugin names. A file already there with the digest it would
 * be written with, which the plugin's file records, is left in place and records nothing; every
 * other file, folder, and changed startup file records its write.
 */
function writeTargets(plan: InstallPlan, { listed, log }: Carrying): void {
  for (const directory of plan.created) {
    writing(directory, () => {
      createDirectory(directory, listed.directoryMode);
    });
  }
  for (const file of listed.files.filter(({ path }) => !plan.unchanged.has(path))) {
    writing(file.path, () => {
      replaceFile(file.path, file.content, file.mode === undefined ? {} : { mode: file.mode });
    });
    fileWritten(log, { path: file.path });
  }
  for (const folder of listed.folders) {
    recordLeftovers(log, writeFolder(folder.path, folder.files));
    fileWritten(log, { path: folder.path });
  }
  applyLines(plan.lines, log);
}

/** Carries out each startup line's action, recording each startup file it changed. */
function applyLines(actions: readonly LineAction[], log: Log): void {
  for (const action of actions) {
    const changed = applyLine(action);
    if (changed !== undefined) {
      fileWritten(log, { path: changed });
    }
  }
}

/**
 * What carrying out an install reads beside its plan: what it lists, the run's log, and what it
 * removes of the recorded files and folders it no longer lists.
 */
interface Carrying {
  readonly listed: Listed;
  readonly log: Log;
  readonly removals: Removals;
}

/** The startup lines' outcome member, absent when no line was listed, recorded, or released. */
function linesMember(actions: readonly LineAction[]): { readonly lines?: StartupLinesOutcome } {
  return actions.length === EMPTY ? {} : { lines: outcomeOf(actions) };
}

/** The writes of an install, which do not stop between targets once the pending file is written. */
function carryOut(path: string, plan: InstallPlan, carrying: Carrying): InstallOutcome {
  const { listed, log } = carrying;
  writeRecordFile(path, plan.pending, log);
  writeTargets(plan, carrying);
  const { kept, removed } = applyRemovals(carrying.removals, log);
  writeRecordFile(path, plan.committed, log);
  return {
    kept,
    removed,
    status: 'installed',
    written: [...listed.files, ...listed.folders].map((target) => target.path),
    ...(plan.replaced.length === EMPTY ? {} : { replaced: plan.replaced }),
    ...linesMember(plan.lines),
  };
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
 * Uninstalls the plugin's files and folders. It reads the plugin's file, every recorded file and
 * folder, and every recorded startup line's file first, and checks that it may remove every file,
 * folder, and directory it would remove and the plugin's file and empty every folder it would
 * remove, so a path it cannot reach, read, or remove fails the run before it removes anything.
 * Then it removes the plugin's file's leftover
 * staging files, recovers a pending plugin's file, removes each recorded file whose digest is
 * unchanged, keeps each one someone changed, removes each unchanged recorded folder whole and keeps
 * each changed one, removes each recorded startup line from its startup file, removes each recorded
 * directory that is then empty, deepest first, and deletes the plugin's file. A released line is
 * dropped without reading or writing its startup file, and a startup file that no longer holds its
 * line is reported. It reads the run signal before the first removal. A path already gone is no
 * error, and a startup file is never removed.
 */
function uninstall(request: UninstallRequest): UninstallOutcome {
  const path = pluginFilePath(request.record, request.plugin);
  const prepared = prepareUninstall(path, new Set(request.release));
  if ('refused' in prepared) {
    return { refused: [prepared.refused], status: 'refused' };
  }
  settle(prepared.found, request.log);
  request.signal.throwIfAborted();
  const outcome = removeEverything(prepared, request.log);
  removeIfPresent(path, request.log);
  return outcome;
}

/**
 * Makes every read and check an uninstall makes before it removes anything, and removes nothing: a
 * plugin that uninstalls from several targets checks each before it uninstalls any, so a path one
 * target cannot reach or remove fails the run with nothing removed. A refusal is left to the
 * uninstall, which reports it.
 */
function checkUninstall(request: RecordRequest & { readonly release?: readonly string[] }): void {
  prepareUninstall(pluginFilePath(request.record, request.plugin), new Set(request.release));
}

/** What an uninstall read before it removes anything: the plugin's file, its removals, and its lines. */
interface UninstallPlan {
  readonly found: Found;
  readonly removals: Removals;
  readonly lines: readonly LineAction[];
}

/**
 * Everything an uninstall reads and checks before it removes anything, without changing anything:
 * the plugin's file, every recorded file and folder, each recorded startup line's file it does not
 * release, and whether it may remove each file, folder, and directory it removes and the plugin's
 * file and empty each folder it removes. It answers the refusal of a plugin's file it cannot read, or what it removes.
 */
function prepareUninstall(
  path: string,
  release: ReadonlySet<string>,
): UninstallPlan | { readonly refused: Refusal<RecordRefusalReason> } {
  const found = examine(path);
  if ('refused' in found) {
    return found;
  }
  const { committed } = found;
  const lines = unlistedActions(committed.lines, release);
  const removals = judgeRemovals(committed.files, committed.folders);
  checkWritable([
    ...removals.files,
    ...removals.folders,
    ...committed.directories.filter((directory) => exists(directory)),
    ...(found.read.kind === 'read' ? [path] : []),
  ]);
  checkEmptiable(removals.folders);
  return { found, lines, removals };
}

/**
 * The removals of an uninstall: each unchanged recorded file, each recorded folder, each recorded
 * startup line as its action says, and each recorded directory that is then empty.
 */
function removeEverything(
  { found, lines, removals }: UninstallPlan,
  log: Log,
): UninstallOutcome & { readonly status: 'uninstalled' } {
  const { kept, removed } = applyRemovals(removals, log);
  applyLines(lines, log);
  removeDirectories(found.committed.directories);
  return {
    kept,
    removed,
    status: 'uninstalled',
    ...uninstalledLinesMember(lines),
  };
}

/** The uninstall outcome's startup lines member, absent when the plugin's file recorded none. */
function uninstalledLinesMember(actions: readonly LineAction[]): {
  readonly lines?: UninstalledLines;
} {
  if (actions.length === EMPTY) {
    return {};
  }
  const { noLongerHeld, released, removed } = outcomeOf(actions);
  return { lines: { noLongerHeld, released, removed } };
}

/**
 * What a plugin's file records, read without writing: its files and, when it records any, its
 * folders and its startup lines, or the refusal of its file.
 */
type RecordedRead =
  | { readonly status: 'refused'; readonly refused: Refusal<RecordRefusalReason> }
  | {
      readonly status: 'read';
      readonly files: readonly CommittedFile[];
      readonly folders?: readonly RecordedFolder[];
      readonly lines?: readonly StartupLine[];
    };

/**
 * What the plugin's file records, read without writing anything: each recorded file with its
 * digest, each recorded folder, and each recorded startup line, none for a missing file, and for a
 * pending file what recovery would keep, reading each pending line's startup file. A damaged file
 * or one of an unknown format refuses, as it refuses an install or uninstall.
 */
function readRecorded(request: RecordRequest): RecordedRead {
  const path = pluginFilePath(request.record, request.plugin);
  const read = readReachable(path);
  if (read.kind === 'refused') {
    return { refused: { path, reason: read.reason }, status: 'refused' };
  }
  if (read.kind === 'missing') {
    return { files: [], status: 'read' };
  }
  const { file } = read;
  const lines = file.state === 'pending' ? file.lines.flatMap(heldLine) : file.lines;
  return {
    files: file.state === 'pending' ? file.files.flatMap(recoveredFile) : file.files,
    ...(file.folders.length === EMPTY
      ? {}
      : {
          folders: file.state === 'pending' ? file.folders.flatMap(recoveredFolder) : file.folders,
        }),
    ...(lines.length === EMPTY ? {} : { lines }),
    status: 'read',
  };
}

/**
 * The directories the plugin's file records the module created, read without writing: for a
 * pending file, those that exist, as recovery keeps them, and none for a missing, damaged, or
 * unknown file. A plugin that keeps one file per shell or target reads them to hand a directory
 * two of its files share to the file that outlives the other.
 */
function recordedDirectories(request: RecordRequest): readonly string[] {
  const read = readReachable(pluginFilePath(request.record, request.plugin));
  if (read.kind !== 'read') {
    return [];
  }
  const { directories, state } = read.file;
  return state === 'pending'
    ? directories.filter((directory) => observe(directory).kind === 'directory')
    : directories;
}

/**
 * Adds directories to those the plugin's file records the module created, so the plugin's own
 * uninstall removes each once it is empty: a plugin that keeps one file per shell or target hands
 * a directory two of its files share to the file that outlives the other. A pending file is
 * recovered first. Answers whether the file records them; a missing, damaged, or unknown file
 * records none and is left as it is.
 */
function adoptDirectories(
  request: RecordChange & { readonly directories: readonly string[] },
): boolean {
  const path = pluginFilePath(request.record, request.plugin);
  const found = examineRecorded(path);
  if (found === undefined) {
    return false;
  }
  settle(found, request.log);
  const { committed } = found;
  const directories = [...new Set([...committed.directories, ...request.directories])];
  if (directories.length !== committed.directories.length) {
    writeRecordFile(path, { ...committed, directories }, request.log);
  }
  return true;
}

/**
 * Whether the plugin's file is `pending`, which an install or uninstall resolves before it acts,
 * read without writing. A missing, damaged, or unknown file is not pending.
 */
function hasPendingRecord(request: RecordRequest): boolean {
  const read = readReachable(pluginFilePath(request.record, request.plugin));
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

/** What a plugin's file lists as registered, or the refusal of its file. */
type RegistrationRead =
  | { readonly status: 'refused'; readonly refused: Refusal<RecordRefusalReason> }
  | { readonly status: 'read'; readonly registration: RecordedRegistration | undefined };

/**
 * The registration the plugin's file records, read without writing: none for a missing file, and
 * for a pending file the one recovery would keep. A damaged file or one of an unknown format
 * refuses, as it refuses an install or uninstall.
 */
function readRegistration(request: RecordRequest): RegistrationRead {
  const path = pluginFilePath(request.record, request.plugin);
  const read = readReachable(path);
  if (read.kind === 'refused') {
    return { refused: { path, reason: read.reason }, status: 'refused' };
  }
  if (read.kind === 'missing') {
    return { registration: undefined, status: 'read' };
  }
  const { file } = read;
  const [registration] =
    file.state === 'pending'
      ? file.registrations.flatMap(recoveredRegistration)
      : file.registrations;
  return { registration, status: 'read' };
}

/** What a plugin says before it runs the agent's call: the command line held, and the one wanted. */
interface PendingRegistrationRequest extends RecordChange {
  readonly name: string;
  /** The command line recorded before, and none when the plugin's file recorded none. */
  readonly prior: readonly string[] | undefined;
  /** The command line the call will leave, and none when the call removes the registration. */
  readonly intended: readonly string[] | undefined;
}

/** Writes the plugin's file pending, before the agent's call that adds or removes the registration. */
function writePendingRegistration(request: PendingRegistrationRequest): void {
  const { log, name, plugin, record } = request;
  const prior = request.prior ?? null;
  const intended = request.intended ?? null;
  const file: Pending = {
    directories: [],
    files: [],
    folders: [],
    lines: [],
    registrations: [{ intended, name, prior }],
    state: 'pending',
  };
  writeRecordFile(pluginFilePath(record, plugin), file, log);
}

/**
 * Removes the staging files a killed write left beside the plugin's file, which it never reads,
 * recording each one removed.
 */
function removeStagingOfPluginFile(request: RecordChange): void {
  recordLeftovers(request.log, removeStagingFiles(pluginFilePath(request.record, request.plugin)));
}

/** Writes the plugin's file committed, once the agent's call settled, with what it holds now. */
function writeCommittedRegistration(request: RecordChange & RecordedRegistration): void {
  const { command, log, name, plugin, record } = request;
  const file: Committed = {
    directories: [],
    files: [],
    folders: [],
    lines: [],
    registrations: [{ command, name }],
    state: 'committed',
  };
  writeRecordFile(pluginFilePath(record, plugin), file, log);
}

/** Deletes the plugin's file, which records nothing once nothing is registered. */
function deletePluginFile(request: RecordChange): void {
  removeIfPresent(pluginFilePath(request.record, request.plugin), request.log);
}

export type {
  InstalledFile,
  InstalledFolder,
  InstallOutcome,
  InstallRequest,
  RecordedRead,
  RecordChange,
  RecordRefusalReason,
  RecordRequest,
  Refusal,
  RefusalReason,
  FolderRefusal,
  RegistrationRead,
  UninstalledLines,
  UninstallOutcome,
  UninstallRequest,
};
export type { InstalledLine, StartupLinesOutcome } from './lines.js';
export type { StartupLine } from './record.js';
export type { StartupEncoding, StartupFileState } from './startup.js';
export { inspectStartupFile } from './startup.js';
export {
  adoptDirectories,
  checkInstall,
  checkUninstall,
  deletePluginFile,
  folderRefusals,
  hasPendingRecord,
  install,
  readRecorded,
  readRegistration,
  recordedDirectories,
  removeStagingOfPluginFile,
  targetRefusals,
  uninstall,
  writeCommittedRegistration,
  writePendingRegistration,
};
