import { join } from 'node:path';

import { FatalError } from '@loomcli/core';
import type { Phrase } from '@loomcli/core';

import { exists, observe } from '../installation/disk.js';
import { readRecorded } from '../installation/files.js';
import { changedReferences, staleFiles } from '../installation/folders.js';
import type { RecordedFolder } from '../installation/record.js';
import { phrasedNotes } from '../phrased-notes.js';
import { actingPlaces, loadForRun, prepare } from './global.js';
import type { ChildRun } from './global.js';
import type { LoadedSkill } from './load.js';
import { skillsPhrase } from './phrases.js';
import {
  directoryNeedsProject,
  guardGlobal,
  projectFolder,
  repositoryRoot,
  startOf,
} from './project.js';
import type { Declared } from './settings.js';
import { statusNote } from './status-notes.js';
import { recordName, selectedTargets } from './targets.js';
import type { Place, Target } from './targets.js';
import type { SkillState, SkillStatus } from './types.js';

const none = 0;
interface StatusOptions {
  readonly agent: Target | undefined;
  readonly project: boolean;
  readonly directory: string | undefined;
}
interface Subject {
  readonly target: Target;
  readonly folder: string;
  readonly project: boolean;
  readonly held?: RecordedFolder | undefined;
  readonly root?: string | undefined;
}
interface Report {
  readonly rows: SkillStatus[];
  readonly notices: Phrase[];
}

/** Sorts a caller-owned list with the pack's ES2022 library. */
function sortedPaths(paths: string[]): string[] {
  // ES2022 has no toSorted; the list belongs to this read alone.
  // oxlint-disable-next-line unicorn/no-array-sort
  return paths.sort((first, second) => Buffer.compare(Buffer.from(first), Buffer.from(second)));
}
/** The first state whose condition applies wins. */
function stateFor(
  subject: Subject,
  differences: { modified: string[]; stale: string[] },
): SkillState {
  const kind = observe(subject.folder).kind;
  if (kind === 'absent') {
    return 'missing';
  }
  if (subject.project ? kind !== 'directory' : subject.held === undefined) {
    return 'unmanaged';
  }
  if (differences.modified.length > none) {
    return 'modified';
  }
  return differences.stale.length > none ? 'stale' : 'current';
}
/** Builds the public row in its specified JSON member order. */
function rowFor(run: ChildRun, skill: LoadedSkill, subject: Subject): SkillStatus {
  const { target, folder, project, held, root } = subject;
  const differences = {
    modified: held === undefined ? [] : sortedPaths(changedReferences(held)),
    stale: staleFiles(folder, skill.files, held?.files),
  };
  const state = stateFor(subject, differences);
  const files = state === 'modified' || state === 'stale' ? differences[state] : [];
  const notes = statusNote(run.name, state, { target, project, root });
  return {
    skill: skill.name,
    target,
    scope: project ? 'project' : 'global',
    state,
    folder,
    files,
    notes: phrasedNotes(notes),
  };
}
/** Finds the project and loads exactly what an install would write, without writing it. */
async function projectRows(
  run: ChildRun,
  declared: Declared,
  options: StatusOptions,
): Promise<Report> {
  const root = repositoryRoot(startOf(run, options.directory));
  guardGlobal(run, root, {
    agent: options.agent,
    names: declared.skills.map(({ name }) => name),
    status: true,
  });
  const loaded = await loadForRun(run, declared);
  guardGlobal(run, root, {
    agent: options.agent,
    names: loaded.map(({ name }) => name),
    status: true,
  });
  const rows = selectedTargets(options.agent).flatMap((target) =>
    loaded.map((skill) =>
      rowFor(run, skill, {
        folder: projectFolder(root, target, skill.name),
        project: true,
        root: options.directory === undefined ? undefined : root,
        target,
      }),
    ),
  );
  return { notices: [], rows };
}
/** Reads one target's record as recovery would, including obsolete installed skills. */
function targetReport(
  run: ChildRun,
  loaded: readonly LoadedSkill[],
  where: { place: Place; record: string },
): Report {
  const { place, record } = where;
  const read = readRecorded({ plugin: recordName(place.target), record });
  if (read.status === 'refused') {
    throw new FatalError(skillsPhrase('statusRecordUnreadable', run.name, read.refused.path));
  }
  const rows = loaded.map((skill) => {
    const folder = join(place.directory, skill.name);
    return rowFor(run, skill, {
      folder,
      held: read.folders?.find((entry) => entry.path === folder),
      project: false,
      target: place.target,
    });
  });
  const notices = (read.folders ?? [])
    .filter(
      (folder) =>
        !loaded.some((skill) => join(place.directory, skill.name) === folder.path) &&
        exists(folder.path),
    )
    .map((folder) =>
      skillsPhrase('obsoleteSkill', run.name, folder.path, changedReferences(folder).length > none),
    );
  return { notices, rows };
}
/** Checks the global locations before loading, then reads every selected target. */
async function globalRows(
  run: ChildRun,
  declared: Declared,
  options: StatusOptions,
): Promise<Report> {
  const prepared = prepare(run, options.agent);
  const places = await actingPlaces(run, prepared.places, 'statusSameFolder');
  const loaded = await loadForRun(run, declared);
  const reports = places.map((place) =>
    targetReport(run, loaded, { place, record: prepared.record }),
  );
  return {
    notices: reports.flatMap((report) => report.notices),
    rows: reports.flatMap((report) => report.rows),
  };
}
/** Reports declared skills and obsolete folders without changing records, files, or leftovers. */
async function statusRows(
  run: ChildRun,
  declared: Declared,
  options: StatusOptions,
): Promise<Report> {
  if (options.directory !== undefined && !options.project) {
    throw directoryNeedsProject();
  }
  const report = await (options.project ? projectRows : globalRows)(run, declared, options);
  run.signal.throwIfAborted();
  return report;
}
export { statusRows };
