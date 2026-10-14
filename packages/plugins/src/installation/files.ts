/**
 * The installed-files module the first-party plugins that install files outside the application
 * share, such as a completion script, a manual page, an agent skill, or a service unit, and the
 * startup lines that load one. Each plugin records what it wrote in its own file in the
 * installation record, `<plugin>.json`, and never takes over a file it did not record; a startup
 * file is the operator's, and the module changes only the lines it records there. The module is
 * internal to the pack: no subpath exports it.
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
import {
  applyLine,
  committedOf,
  createdParentsOf,
  heldLine,
  outcomeOf,
  pendingOf,
  planLines,
  recoveredLine,
  unlistedActions,
} from './lines.js';
import type { InstalledLine, LineAction, LineListing, StartupLinesOutcome } from './lines.js';
import {
  isLineText,
  nothingRecorded,
  pluginFilePath,
  readPluginFile,
  writePluginFile,
} from './record.js';
import type {
  Committed,
  CommittedFile,
  Pending,
  PendingFile,
  RecordedFolder,
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
 * Whose files, the run's signal, and the startup files whose recorded lines the plugin releases
 * because it cannot change them: each is dropped from the plugin's file and reported, and its
 * startup file is neither read nor written.
 */
interface UninstallRequest extends RecordRequest {
  readonly signal: AbortSignal;
  readonly release?: readonly string[];
}

/**
 * What an install writes: files, folders, startup lines, or any of them. The force mode, which only
 * the skills plugin passes, replaces an unrecorded folder at a listed folder's path in place of
 * refusing. An update adds no recorded line its startup file no longer holds, and drops it from the
 * plugin's file. The directory mode is the permission bits of each directory the install creates,
 * whatever the umask. A kept startup file's recorded line stays recorded as it is, and its startup
 * file is neither read nor written, as for a file the plugin cannot read.
 */
interface InstallRequest extends UninstallRequest {
  readonly keep?: readonly string[];
  readonly files: readonly InstalledFile[];
  readonly folders?: readonly InstalledFolder[];
  readonly force?: boolean;
  readonly lines?: readonly InstalledLine[];
  readonly update?: boolean;
  readonly directoryMode?: number;
}

/**
 * Resolves a pending plugin's file by what is on disk: a path holding the intended or the prior
 * digest stays recorded with it, and one that is gone or holds any other digest is dropped. A
 * listed directory that exists stays, and so does every listed folder, whether or not it is there.
 * A pending startup line keeps the intended text or the prior one, whichever its file holds, or no
 * line. Leftover staging files, of targets and of startup files, and the staging and retired
 * folders beside each listed folder are removed, and the result is written as committed.
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
    lines: pending.lines.flatMap(recoveredLine),
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
  ].map(({ path }) => ({ path }));
  return {
    committed: {
      directories,
      files: written.map(({ intended, path }) => ({ digest: intended, path })),
      folders: folders.map(({ path }) => ({ path })),
      lines: [],
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

/** The rule a startup line's text breaks, or none for one line of text with no line break. */
function lineTextFault(line: string): string | undefined {
  if (isLineText(line)) {
    return undefined;
  }
  return line === '' ? 'is empty' : 'holds a line break';
}

/** Throws a TypeError for the first startup line whose text is empty or holds a line break. */
function checkLineTexts(lines: readonly InstalledLine[]): void {
  for (const { line, path } of lines) {
    const fault = lineTextFault(line);
    if (fault !== undefined) {
      throw new TypeError(`Startup line for "${path}" ${fault}.`);
    }
  }
}

/**
 * Throws a TypeError for the first startup file path of a kind, released or kept, that conflicts
 * with a path the install names otherwise, or that is not absolute, not normalized, or named twice.
 */
function checkNamedPaths(
  label: 'Released' | 'Kept',
  paths: readonly string[],
  conflict: (path: string) => string | undefined,
): void {
  const named = new Set<string>();
  for (const path of paths) {
    const fault = conflict(path) ?? targetPathFault(path, named);
    if (fault !== undefined) {
      throw new TypeError(`${label} startup file path "${path}" ${fault}.`);
    }
    named.add(path);
  }
}

/**
 * Throws a TypeError for the first released, then kept, startup file path that is not absolute,
 * not normalized, named twice, listed with a line in the same install, or kept and released both.
 */
function checkStartupPaths(
  { keep, release }: { readonly release: readonly string[]; readonly keep: readonly string[] },
  lines: readonly InstalledLine[],
): void {
  const listed = new Set(lines.map(({ path }) => path));
  const released = new Set(release);
  const withLine = (path: string) => (listed.has(path) ? 'is listed with a line too' : undefined);
  checkNamedPaths('Released', release, withLine);
  checkNamedPaths('Kept', keep, (path) =>
    released.has(path) ? 'is released too' : withLine(path),
  );
}

/** The released startup file paths of an uninstall, after the checks above. */
function releasedPaths(release: readonly string[]): ReadonlySet<string> {
  checkStartupPaths({ keep: [], release }, []);
  return new Set(release);
}

/** The targets a request names, as the checks below read them. */
interface Targets {
  readonly files: readonly InstalledFile[];
  readonly folders: readonly InstalledFolder[];
  readonly lines: readonly InstalledLine[];
  readonly release: readonly string[];
  readonly keep: readonly string[];
}

/**
 * Throws a TypeError for the first target path, of a file, a folder, or a startup file, that is not
 * absolute, not normalized, or listed twice, for the first file of a folder whose path is not
 * relative and normalized, for the first startup line whose text is not one line, and for the
 * first released or kept path that breaks the same rules: a first-party plugin's bug, which the
 * module never repairs by normalizing or merging.
 */
function checkTargetPaths(targets: Targets): void {
  const listed = new Set<string>();
  const kinds = [
    ...targets.files.map(({ path }) => ({ kind: 'file', path })),
    ...targets.folders.map(({ path }) => ({ kind: 'folder', path })),
    ...targets.lines.map(({ path }) => ({ kind: 'startup file', path })),
  ];
  for (const { kind, path } of kinds) {
    const fault = targetPathFault(path, listed);
    if (fault !== undefined) {
      throw new TypeError(`Installed ${kind} path "${path}" ${fault}.`);
    }
    listed.add(path);
  }
  targets.folders.forEach(checkFolderFilePaths);
  checkLineTexts(targets.lines);
  checkStartupPaths(targets, targets.lines);
}

/**
 * Installs the plugin's files and folders. A target path that is not absolute, not normalized, or
 * listed twice throws a TypeError before anything is read or written. It recovers a pending
 * plugin's file first, then checks every target: a file target that is absent, or a regular file
 * the plugin recorded with its digest unchanged, may be written, and a folder target that is
 * absent or recorded may be replaced whatever is inside it. Any other target refuses the whole
 * install, which writes nothing, except an unrecorded folder target under the force mode, which is
 * replaced and recorded. It reads the run signal before the pending write and, once it has begun,
 * does not stop between targets. Each file goes through a staging file and a rename, unless it is
 * already there with the digest it would be written with, each folder through a staging folder and
 * renames, and each recorded file the install no longer lists is removed when no one changed it,
 * and each recorded folder it no longer lists is removed whole.
 * Each listed startup line is added, recorded as held, or replaced where it stands, each recorded
 * line it no longer lists is removed, each released line is dropped, and each kept line stays
 * recorded, as Installed files states.
 */
function install(request: InstallRequest): InstallOutcome {
  const targets = targetsOf(request);
  checkTargetPaths(targets);
  const listed = listedOf(request, targets);
  const path = pluginFilePath(request.record, request.plugin);
  const prepared = prepareInstall(path, listed);
  if ('refused' in prepared) {
    return { refused: prepared.refused, status: 'refused' };
  }
  request.signal.throwIfAborted();
  return carryOut(path, prepared.plan, listed);
}

/** The targets an install request names, each list it leaves out empty. */
function targetsOf(request: InstallRequest): Targets {
  return {
    files: request.files,
    folders: request.folders ?? [],
    keep: request.keep ?? [],
    lines: request.lines ?? [],
    release: request.release ?? [],
  };
}

/** What an install request lists, with its startup lines' releases, keeps, and update mark. */
function listedOf(request: InstallRequest, targets: Targets): Listed {
  return {
    directoryMode: request.directoryMode,
    files: targets.files,
    folders: targets.folders,
    force: request.force === true,
    lines: {
      keep: new Set(targets.keep),
      lines: targets.lines,
      release: new Set(targets.release),
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
 * the refusals of every kind of target, the unrecorded folders the force mode takes over, and what
 * the install does to each startup line.
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
  return { lines: lines.actions, observed, refused, replaced: unrecorded.map(({ path }) => path) };
}

/**
 * Everything an install reads before it writes: the plugin's file, recovered when pending, every
 * target, and every startup file it would change. It answers each path that refuses the install,
 * or the plan it carries out.
 */
function prepareInstall(
  path: string,
  listed: Listed,
): { readonly refused: readonly Refusal[] } | { readonly plan: InstallPlan } {
  const found = recorded(path);
  if ('refused' in found) {
    return { refused: [found.refused] };
  }
  const targets = readTargets(listed, found.committed);
  if (targets.refused.length !== EMPTY) {
    return { refused: targets.refused };
  }
  const plan = planInstall(withPriors(targets.observed), listed.folders, found.committed);
  return { plan: withLines({ ...plan, replaced: targets.replaced }, targets.lines) };
}

/**
 * The writes of the files, folders, and startup lines, in that order, after the missing parents are
 * created with the directory mode the plugin names. A file already there with the digest it would
 * be written with, which the plugin's file records, is left in place.
 */
function writeTargets(plan: InstallPlan, listed: Listed): void {
  for (const directory of plan.created) {
    createDirectory(directory, listed.directoryMode);
  }
  for (const file of listed.files.filter(({ path }) => !plan.unchanged.has(path))) {
    replaceFile(file.path, file.content, file.mode === undefined ? {} : { mode: file.mode });
  }
  for (const folder of listed.folders) {
    writeFolder(folder.path, folder.files);
  }
  plan.lines.forEach(applyLine);
}

/** The startup lines' outcome member, absent when no line was listed, recorded, or released. */
function linesMember(actions: readonly LineAction[]): { readonly lines?: StartupLinesOutcome } {
  return actions.length === EMPTY ? {} : { lines: outcomeOf(actions) };
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
    ...linesMember(plan.lines),
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
 * folder whole, removes each recorded startup line from its startup file, removes each recorded
 * directory that is then empty, deepest first, and deletes the plugin's file. A released line is
 * dropped without reading or writing its startup file, and a startup file that no longer holds its
 * line is reported. It reads the run signal before the first removal. A path already gone is no
 * error, and a startup file is never removed.
 */
function uninstall(request: UninstallRequest): UninstallOutcome {
  const release = releasedPaths(request.release ?? []);
  const path = pluginFilePath(request.record, request.plugin);
  const found = recorded(path);
  if ('refused' in found) {
    return { refused: [found.refused], status: 'refused' };
  }
  const lines = unlistedActions(found.committed.lines, release);
  request.signal.throwIfAborted();
  const outcome = removeEverything(found.committed, lines);
  rmSync(path, { force: true });
  return outcome;
}

/**
 * The removals of an uninstall: each unchanged recorded file, each recorded folder, each recorded
 * startup line as its action says, and each recorded directory that is then empty.
 */
function removeEverything(
  committed: Committed,
  lines: readonly LineAction[],
): UninstallOutcome & { readonly status: 'uninstalled' } {
  const { kept, removed } = removeRecorded(committed.files);
  const removedFolders = removeFolders(committed.folders);
  lines.forEach(applyLine);
  removeDirectories(committed.directories);
  return {
    kept,
    removed: [...removed, ...removedFolders],
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
  const read = readPluginFile(path);
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
    ...(file.folders.length === EMPTY ? {} : { folders: file.folders }),
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
  const read = readPluginFile(pluginFilePath(request.record, request.plugin));
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
  request: RecordRequest & { readonly directories: readonly string[] },
): boolean {
  const path = pluginFilePath(request.record, request.plugin);
  const found = readPluginFile(path).kind === 'read' ? recorded(path) : undefined;
  if (found === undefined || 'refused' in found) {
    return false;
  }
  const { committed } = found;
  const directories = [...new Set([...committed.directories, ...request.directories])];
  if (directories.length !== committed.directories.length) {
    writePluginFile(path, { ...committed, directories });
  }
  return true;
}

/**
 * Whether the plugin's file is `pending`, which an install or uninstall resolves before it acts,
 * read without writing. A missing, damaged, or unknown file is not pending.
 */
function hasPendingRecord(request: RecordRequest): boolean {
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
  RecordRequest,
  Refusal,
  RefusalReason,
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
  folderRefusals,
  hasPendingRecord,
  install,
  readRecorded,
  recordedDirectories,
  targetRefusals,
  uninstall,
};
