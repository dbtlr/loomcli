/*
 * The project install: an unrecorded copy of each skill's folder at the repository root, replaced
 * whole every time. Nothing is recorded, so a project folder has no update, uninstall, or takeover
 * check.
 */
import { lstatSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { InputError } from '@loomcli/core';

import { exists } from '../installation/disk.js';
import { writeFolder } from '../installation/folders.js';
import type { ChildRun } from './global.js';
import { loadSkills } from './load.js';
import type { LoadedSkill } from './load.js';
import { lines, refusals, shown } from './messages.js';
import { realFolder, selectedTargets, skillsDirectory } from './targets.js';
import type { Target } from './targets.js';
import type { Skill } from './types.js';

/** An input problem on the `--directory` option, which exits 2. */
function directoryProblem(message: string, issue: string): InputError {
  return new InputError(message, [
    {
      input: { global: false, kind: 'option', name: 'directory' },
      issues: [{ message: issue }],
      reason: 'invalid',
      spelling: '--directory',
    },
  ]);
}

/** The refusal of `--directory` without `--project`, which the action throws before anything else. */
function directoryNeedsProject(): InputError {
  return directoryProblem(
    'Option "--directory" needs --project. Add --project, or leave out --directory.',
    'Add --project, or leave out --directory.',
  );
}

/** The directory the walk starts at: the working directory, or `--directory` resolved against it. */
function startOf(run: ChildRun, directory: string | undefined): string {
  const start = directory === undefined ? run.host.cwd : resolve(run.host.cwd, directory);
  if (statSync(start, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw directoryProblem(
      `Option "--directory" names ${shown(start)}, which is not a directory. Name a directory that exists.`,
      'Name a directory that exists.',
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
function guardGlobal(run: ChildRun, root: string, request: ProjectRequest): void {
  const names = request.skills.map(({ name }) => name);
  for (const target of selectedTargets(request.agent)) {
    const clash = clashOf(run, root, { names, target });
    if (clash !== undefined) {
      throw refusals.neverGlobal(run.name, clash);
    }
  }
}

/** What `install --project` reads from the command line. */
interface ProjectRequest {
  readonly skills: readonly Skill[];
  readonly agent: Target | undefined;
  readonly directory: string | undefined;
}

/** Replaces one skill's folder under the root whole and states it. */
async function replaceFolder(
  run: ChildRun,
  { folder, loaded, target }: { folder: string; loaded: LoadedSkill; target: Target },
): Promise<void> {
  const replacing = exists(folder);
  mkdirSync(dirname(folder), { recursive: true });
  writeFolder(folder, loaded.files);
  await run.success(
    (replacing ? lines.installedOver : lines.installed)(loaded.name, target, folder),
  );
}

/**
 * `install --project`: the root, the guard against the global folder, and the loaders, all before
 * any write, then each skill's folder replaced whole for each selected target.
 */
async function installProject(run: ChildRun, request: ProjectRequest): Promise<void> {
  const root = repositoryRoot(startOf(run, request.directory));
  guardGlobal(run, root, request);
  const loaded = await loadSkills(request.skills);
  run.signal.throwIfAborted();
  for (const target of selectedTargets(request.agent)) {
    for (const skill of loaded) {
      await replaceFolder(run, {
        folder: projectFolder(root, target, skill.name),
        loaded: skill,
        target,
      });
    }
  }
}

export { directoryNeedsProject, installProject };
