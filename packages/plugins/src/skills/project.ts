/*
 * The project install: an unrecorded copy of each skill's folder at the repository root, replaced
 * whole every time. Nothing is recorded, so a project folder has no update, uninstall, or takeover
 * check.
 */
import { lstatSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { FatalError, InputError, phrasedIssue } from '@loomcli/core';
import type { Phrase } from '@loomcli/core';

import { fileWritten } from '../change-events.js';
import {
  checkEmptiable,
  checkWritable,
  createDirectory,
  exists,
  folderLeftovers,
  missingParents,
  recordLeftovers,
} from '../installation/disk.js';
import { writeFolder } from '../installation/folders.js';
import { writing } from '../installation/reach.js';
import { loadForRun } from './global.js';
import type { ChildRun } from './global.js';
import type { LoadedSkill } from './load.js';
import { skillsPhrase } from './phrases.js';
import type { Declared } from './settings.js';
import { realFolder, selectedTargets, skillsDirectory } from './targets.js';
import type { Target } from './targets.js';

/** An input problem on the `--directory` option, which exits 2. */
function directoryProblem(message: Phrase, issue: Phrase): InputError {
  return new InputError(message, [
    {
      input: { global: false, kind: 'option', name: 'directory' },
      issues: [phrasedIssue(issue)],
      reason: 'invalid',
      spelling: '--directory',
    },
  ]);
}

/** The refusal of `--directory` without `--project`, which the action throws before anything else. */
function directoryNeedsProject(): InputError {
  return directoryProblem(
    skillsPhrase('directoryWithoutProject'),
    skillsPhrase('directoryWithoutProjectIssue'),
  );
}

/** The directory the walk starts at: the working directory, or `--directory` resolved against it. */
function startOf(run: ChildRun, directory: string | undefined): string {
  const start = directory === undefined ? run.host.cwd : resolve(run.host.cwd, directory);
  if (statSync(start, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw directoryProblem(
      skillsPhrase('directoryMissing', start),
      skillsPhrase('directoryMissingIssue'),
    );
  }
  return start;
}

/**
 * The nearest directory from `start` up that holds an entry named `.git` of any kind, a directory
 * in a clone and a file in a worktree or a submodule; the start itself when none does.
 */
function repositoryRoot(start: string): string {
  for (let directory = start; ; directory = dirname(directory)) {
    if (lstatSync(join(directory, '.git'), { throwIfNoEntry: false }) !== undefined) {
      return directory;
    }
    if (dirname(directory) === directory) {
      return start;
    }
  }
}

/** The folder of a skill under a root, for a target. */
function projectFolder(root: string, target: Target, name: string): string {
  return join(root, `.${target}`, 'skills', name);
}

/** The global folder a skill's project folder is, compared by real paths, or none. */
function clashOf(
  run: ChildRun,
  root: string,
  { names, target }: { readonly target: Target; readonly names: readonly string[] },
): string | undefined {
  const global = skillsDirectory(target, run.host);
  const kept =
    global === undefined ? [] : names.map((name) => ({ folder: join(global, name), name }));
  return kept.find(
    ({ folder, name }) => realFolder(projectFolder(root, target, name)) === realFolder(folder),
  )?.folder;
}

/**
 * Refuses a project folder that is the target's global folder, compared by real paths so a linked
 * root, a linked `.claude` or `.agents`, or a linked home is seen.
 */
function guardGlobal(
  run: ChildRun,
  root: string,
  {
    agent,
    names,
    status,
  }: {
    readonly agent: Target | undefined;
    readonly names: readonly string[];
    readonly status?: boolean;
  },
): void {
  for (const target of selectedTargets(agent)) {
    const clash = clashOf(run, root, { names, target });
    if (clash !== undefined) {
      throw new FatalError(
        skillsPhrase(status ? 'statusProjectIsGlobal' : 'projectIsGlobal', run.name, clash),
      );
    }
  }
}

/** What `install --project` reads from the command line. */
interface ProjectRequest {
  readonly skills: Declared;
  readonly agent: Target | undefined;
  readonly directory: string | undefined;
}

/**
 * Checks that the run's user may write each of the given skill folders and empty each one that is
 * there and each leftover staging and retired folder beside it, then creates each missing folder
 * above them, outermost first, before any skill folder is written, so a folder that cannot be
 * written, emptied, or created fails the run naming that folder, with no skill folder replaced.
 */
function readyFolders(folders: readonly string[]): void {
  checkWritable(folders);
  checkEmptiable([...folders, ...folders.flatMap(folderLeftovers)]);
  for (const directory of new Set(folders.flatMap(missingParents))) {
    writing(directory, () => {
      createDirectory(directory);
    });
  }
}

/** Replaces one skill's folder under the root whole, records it, and states it. */
async function replaceFolder(
  run: ChildRun,
  { folder, loaded, target }: { folder: string; loaded: LoadedSkill; target: Target },
): Promise<void> {
  const replacing = exists(folder);
  recordLeftovers(run.log, writeFolder(folder, loaded.files));
  fileWritten(run.log, { path: folder });
  await run.success(
    skillsPhrase(replacing ? 'installedSkillOver' : 'installedSkill', loaded.name, target, folder),
  );
}

/**
 * `install --project`: the root, the guard against the global folder, the folder and the loaders,
 * the guard again for the folder's skills, and the check that the run's user may write every skill
 * folder of every selected target and empty each one that is there and each leftover staging and
 * retired folder beside it, all before any write, then the missing folders above every skill
 * folder created, and each skill's folder replaced whole for each selected target. So a folder
 * one target cannot take fails the run with no copy replaced.
 */
async function installProject(run: ChildRun, request: ProjectRequest): Promise<void> {
  const root = repositoryRoot(startOf(run, request.directory));
  const { agent } = request;
  guardGlobal(run, root, { agent, names: request.skills.skills.map(({ name }) => name) });
  const loaded = await loadForRun(run, request.skills);
  // Only the folder knows its skills' names, so its skills meet the guard once they are read.
  guardGlobal(run, root, { agent, names: loaded.map(({ name }) => name) });
  run.signal.throwIfAborted();
  const writes = selectedTargets(request.agent).flatMap((target) =>
    loaded.map((skill) => ({
      folder: projectFolder(root, target, skill.name),
      loaded: skill,
      target,
    })),
  );
  readyFolders(writes.map(({ folder }) => folder));
  for (const write of writes) {
    await replaceFolder(run, write);
  }
}

export {
  startOf,
  repositoryRoot,
  projectFolder,
  guardGlobal,
  directoryNeedsProject,
  installProject,
};
