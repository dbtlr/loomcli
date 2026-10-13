/*
 * The global children: `install`, `update`, and `uninstall` act on the skill folders under the
 * operator's home, which the installation record lists as installed folders, one plugin's file for
 * each target.
 */
import { join } from 'node:path';

import type { Host } from '@loomcli/core';

import {
  folderRefusals,
  hasPendingRecord,
  install,
  readRecorded,
  uninstall,
} from '../installation/files.js';
import type { InstalledFolder, InstallOutcome, Refusal } from '../installation/files.js';
import { folderHoldsExactly } from '../installation/folders.js';
import { loadSkills } from './load.js';
import type { LoadedSkill } from './load.js';
import { lines, refusals } from './messages.js';
import { globalPlaces, realPath, recordDirectory, selectedTargets } from './targets.js';
import type { Place, Target } from './targets.js';
import type { Skill } from './types.js';

/** What a child reads from its action: the application, the run, and the lanes it writes. */
interface ChildRun {
  readonly name: string;
  readonly host: Host;
  readonly signal: AbortSignal;
  readonly info: (message: string) => Promise<void>;
  readonly success: (message: string) => Promise<void>;
  readonly warn: (message: string) => Promise<void>;
}

/** The count of an empty list. */
const none = 0;

/** The Commands that write the skills of a target. */
type WritingVerb = 'install' | 'update';

/** The plugin's file in the installation record for a target, `skills.<target>.json`. */
function recordName(target: Target): string {
  return `skills.${target}`;
}

/** A folder an install writes, with the name of the skill it holds. */
interface NamedFolder extends InstalledFolder {
  readonly name: string;
}

/** The folders of the loaded skills under a skills directory. */
function foldersIn(directory: string, loaded: readonly LoadedSkill[]): NamedFolder[] {
  return loaded.map(({ files, name }) => ({ files, name, path: join(directory, name) }));
}

/** The run and the record's directory, which every read of a plugin's file needs. */
interface Where {
  readonly run: ChildRun;
  readonly record: string;
}

/**
 * The checks every global child makes before it loads or reads anything: the selected targets'
 * directories, then the record's directory.
 */
function prepare(
  run: ChildRun,
  agent: Target | undefined,
): Where & { readonly places: readonly Place[] } {
  const places = globalPlaces(run.name, run.host, selectedTargets(agent));
  return { places, record: recordDirectory(run.name, run.host), run };
}

/**
 * The places a child acts on: both, or the first alone when a link makes the two skills
 * directories one folder, which it states.
 */
async function actingPlaces(run: ChildRun, places: readonly Place[]): Promise<readonly Place[]> {
  const [first, second] = places;
  if (first === undefined || second === undefined) {
    return places;
  }
  if (realPath(first.directory) !== realPath(second.directory)) {
    return places;
  }
  await run.info(lines.sameFolder(run.name, second.directory, first.directory));
  return [first];
}

/** A place with the folders its plugin's file lists, and whether that file is still `pending`. */
interface Recorded {
  readonly place: Place;
  readonly folders: readonly string[];
  readonly pending: boolean;
}

/** The folders each place's plugin's file lists, or the refusal of a file that cannot be read. */
function recordedBy(
  where: Where,
  places: readonly Place[],
  verb: 'install' | 'uninstall',
): readonly Recorded[] {
  return places.map((place) => {
    const request = { plugin: recordName(place.target), record: where.record };
    const read = readRecorded(request);
    if (read.status === 'refused') {
      throw refusals.record(where.run.name, read.refused.path, verb);
    }
    return {
      folders: (read.folders ?? []).map(({ path }) => path),
      pending: hasPendingRecord(request),
      place,
    };
  });
}

/** A recorded target with the folders an install would write there. */
interface Wanted extends Recorded {
  readonly wanted: readonly NamedFolder[];
}

/** The refusals of every wanted folder that something other than the record's folder holds. */
function unrecorded(entries: readonly Wanted[]): readonly Refusal[] {
  return entries.flatMap(({ folders, wanted }) =>
    folderRefusals(
      wanted.map(({ path }) => path),
      folders.map((path) => ({ path })),
    ),
  );
}

/**
 * Whether a target's skills are all unchanged and its plugin's file lists no other folder. A
 * `pending` file is never unchanged: the module's install resolves it and removes its leftovers.
 */
function isUnchanged({ folders, pending, wanted }: Wanted): boolean {
  const paths = new Set(folders);
  return (
    !pending &&
    paths.size === wanted.length &&
    wanted.every(
      (folder) => paths.has(folder.path) && folderHoldsExactly(folder.path, folder.files),
    )
  );
}

/** The refusal an install returns, as the failure the child reports. */
function failureOf(run: ChildRun, verb: WritingVerb, refused: readonly Refusal[]): Error {
  const [first] = refused;
  if (first?.reason === 'damaged' || first?.reason === 'unknown-format') {
    return refusals.record(run.name, first.path, 'install');
  }
  return refusals.inTheWay(run.name, verb);
}

/** What `install` and `update` read from the command line. */
interface InstallRequest {
  readonly skills: readonly Skill[];
  readonly verb: WritingVerb;
  readonly agent: Target | undefined;
  readonly force: boolean;
}

/** What a write of a target reads: the run and record, the Command's verb, and the force mode. */
interface Writing extends Where {
  readonly verb: WritingVerb;
  readonly force: boolean;
}

/** States the folders the install replaced, wrote, and removed. */
async function reportInstall(
  writing: Writing,
  entry: Wanted,
  outcome: Extract<InstallOutcome, { status: 'installed' }>,
): Promise<void> {
  const { run } = writing;
  for (const folder of outcome.replaced ?? []) {
    await run.info(lines.replaced(run.name, folder));
  }
  for (const { name, path } of entry.wanted) {
    await run.success(
      writing.verb === 'update'
        ? lines.updated(name, entry.place.target, path)
        : lines.installed(name, entry.place.target, path),
    );
  }
  for (const folder of outcome.removed) {
    await run.info(lines.removed(folder));
  }
}

/** Writes the skills of one target through the module, or states that they are unchanged. */
async function writeTarget(writing: Writing, entry: Wanted): Promise<void> {
  const { record, run } = writing;
  if (isUnchanged(entry)) {
    for (const { path } of entry.wanted) {
      await run.info(lines.unchanged(path));
    }
    return;
  }
  const outcome = install({
    files: [],
    folders: entry.wanted,
    force: writing.force,
    plugin: recordName(entry.place.target),
    record,
    signal: run.signal,
  });
  if (outcome.status === 'refused') {
    throw failureOf(run, writing.verb, outcome.refused);
  }
  await reportInstall(writing, entry, outcome);
}

/**
 * The targets an install or update writes, each with the folders it would write: after the checks,
 * the loaders, and the record. `update` keeps the targets whose plugin's file lists a folder.
 */
async function chosenTargets(
  where: Where,
  request: InstallRequest,
  places: readonly Place[],
): Promise<readonly Wanted[]> {
  const acting = await actingPlaces(where.run, places);
  const loaded = await loadSkills(request.skills);
  const entries = recordedBy(where, acting, 'install');
  const chosen =
    request.verb === 'update' ? entries.filter(({ folders }) => folders.length > none) : entries;
  return chosen.map(({ folders, pending, place }) => ({
    folders,
    pending,
    place,
    wanted: foldersIn(place.directory, loaded),
  }));
}

/** Refuses, before any write, every folder something else holds, stating each one. */
async function refuseUnrecorded(
  run: ChildRun,
  request: InstallRequest,
  chosen: readonly Wanted[],
): Promise<void> {
  const refused = request.force ? [] : unrecorded(chosen);
  for (const { path } of refused) {
    await run.warn(lines.notInstalled(run.name, path));
  }
  if (refused.length > none) {
    throw refusals.inTheWay(run.name, request.verb);
  }
}

/**
 * `install` and `update` at global scope: the checks, the loaders, the record, and every refusal
 * before any write, then each target written or stated unchanged. `update` acts only on the targets
 * whose plugin's file lists a folder.
 */
async function installGlobal(run: ChildRun, request: InstallRequest): Promise<void> {
  const { places, ...where } = prepare(run, request.agent);
  const chosen = await chosenTargets(where, request, places);
  if (chosen.length === none) {
    await run.success(lines.noneToUpdate(run.name));
    return;
  }
  await refuseUnrecorded(run, request, chosen);
  const writing = { ...where, force: request.force, verb: request.verb };
  for (const entry of chosen) {
    await writeTarget(writing, entry);
  }
}

/** Removes one target's recorded folders through the module and states each. */
async function removeTarget(where: Where, entry: Recorded): Promise<void> {
  const { record, run } = where;
  const outcome = uninstall({ plugin: recordName(entry.place.target), record, signal: run.signal });
  if (outcome.status === 'refused') {
    const [refused] = outcome.refused;
    throw refusals.record(run.name, refused?.path ?? record, 'uninstall');
  }
  for (const folder of entry.folders) {
    await run.info(outcome.removed.includes(folder) ? lines.removed(folder) : lines.gone(folder));
  }
}

/** `uninstall`: the module removes each target's recorded folders, and the child states each. */
async function uninstallGlobal(run: ChildRun, agent: Target | undefined): Promise<void> {
  const { places, ...where } = prepare(run, agent);
  const acting = await actingPlaces(run, places);
  const recording = recordedBy(where, acting, 'uninstall').filter(
    ({ folders }) => folders.length > none,
  );
  if (recording.length === none) {
    await run.success(lines.noneToRemove(run.name));
    return;
  }
  for (const entry of recording) {
    await removeTarget(where, entry);
  }
}

export type { ChildRun };
export { installGlobal, uninstallGlobal };
