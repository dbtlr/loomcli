/*
 * The operator sentences of the skills plugin, under ADR-0164. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

import type { SkillState } from './types.js';

const shown = escapeControlCharacters;

const shownPath = (path: string): string => nowrap(shown(path));

function skillsInTheWay(name: string, verb: 'install' | 'update'): string {
  return `${shown(name)} skills ${shown(verb)} changed nothing, because folders it did not install, or whose command references changed since it installed them, are in the way. Copy any file you want to keep out of them, then remove them or run ${shown(name)} skills install --force to replace them.`;
}

function projectIsGlobal(name: string, folder: string): string {
  return `${shown(name)} skills install --project would write to ${shownPath(folder)}, the folder ${shown(name)} skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project.`;
}

function recordUnreadable(name: string, record: string, verb: 'install' | 'uninstall'): string {
  return `${shownPath(record)} cannot be read, so ${shown(name)} will not change the folders it lists. Remove it and the folders it lists, then run ${shown(name)} skills ${shown(verb)} again.`;
}

const directoryWithoutProjectIssue = 'Add --project, or leave out --directory.';

const directoryWithoutProject =
  'Option "--directory" needs --project. Add --project, or leave out --directory.';

const directoryMissingIssue = 'Name a directory that exists.';

function directoryMissing(start: string): string {
  return `Option "--directory" names ${shown(start)}, which is not a directory. Name a directory that exists.`;
}

function folderGone(folder: string): string {
  return `${shownPath(folder)} was already gone.`;
}

function installedSkill(name: string, target: string, folder: string): string {
  return `Installed ${shown(name)} for ${shown(target)} in ${shownPath(folder)}.`;
}

function installedSkillOver(name: string, target: string, folder: string): string {
  return `Installed ${shown(name)} for ${shown(target)} in ${shownPath(folder)}, replacing the copy that was there.`;
}

function noSkillsToRemove(name: string): string {
  return `${shown(name)} has no skills installed in your home folder, so there is nothing to remove.`;
}

function noSkillsToUpdate(name: string): string {
  return `${shown(name)} has no skills installed in your home folder, so there is nothing to update. Run ${shown(name)} skills install to install them.`;
}

function folderNotInstalled(name: string, folder: string): string {
  return `${shownPath(folder)} was not installed by ${shown(name)} skills install.`;
}

function removedFolder(folder: string): string {
  return `Removed ${shownPath(folder)}.`;
}

function replacedFolder(name: string, folder: string): string {
  return `Replaced ${shownPath(folder)}, which ${shown(name)} skills install did not install.`;
}

function sameSkillsFolder(name: string, agents: string, claude: string): string {
  return `${shownPath(agents)} is the same folder as ${shownPath(claude)}, so ${shown(name)} acts on it once, for claude.`;
}

function folderUnchanged(folder: string): string {
  return `${shownPath(folder)} is unchanged.`;
}

function updatedSkill(name: string, target: string, folder: string): string {
  return `Updated ${shown(name)} for ${shown(target)} in ${shownPath(folder)}.`;
}

function skillsNotRefreshed(path: string, name: string): string {
  return `The skills were not refreshed because ${shown(path)} could not start. Run ${shown(name)} skills update.\n`;
}

/**
 * The `-vv` line of an author's file `install` or `update` left out of a skill, because the plugin
 * owns its name for the skill's command references, with the fields `path` and `skill`.
 */
const skillFileLeftOut =
  'Left out {path}, which the skill {skill} supplies, because the plugin owns that name for its command references.';

/** The refresh's `-vv` line when the installation record holds none of the plugin's files. */
const skillsRefreshSkipped = 'Skipped the skills refresh: nothing is installed.';

function referenceChanged(name: string, file: string): string {
  return `${shownPath(file)} changed since ${shown(name)} skills install wrote it.`;
}
function replacedModified(name: string, folder: string): string {
  return `Replaced ${shownPath(folder)}, whose command references changed since ${shown(name)} skills install wrote them.`;
}
function modifiedKept(name: string, folder: string): string {
  return `${shownPath(folder)} was left in place, because command references in it changed since ${shown(name)} skills install wrote them. Copy what you want to keep, then remove the folder.`;
}

interface NoteScope {
  readonly target: string;
  readonly project: boolean;
  readonly root?: string | undefined;
}
/** The target-specific project step, whose values are escaped before composition. */
function installStep(name: string, scope: NoteScope): string {
  const directory = scope.root === undefined ? '' : ` --directory ${shown(scope.root)}`;
  return `${shown(name)} skills install${scope.project ? ' --project' : ''} --agent ${shown(scope.target)}${directory}`;
}
function projectNote(name: string, state: SkillState, install: string): string[] {
  if (state === 'missing') {
    return [`Run ${install} to install it.`];
  }
  if (state === 'unmanaged') {
    return [
      `${shown(name)} skills install --project did not write this, because it is not a folder. Run ${install} to replace it.`,
    ];
  }
  return [`Run ${install} to replace it with this version's.`];
}
/** The global notes explain refusal conditions before offering a replacing command. */
function globalNote(name: string, state: SkillState, install: string): string[] {
  if (state === 'missing') {
    return [`Run ${install} to install it, once no skill reads modified or unmanaged.`];
  }
  if (state === 'unmanaged') {
    return [
      `The installation record does not list what is at this path. Remove it, or run ${install} --force to replace it.`,
    ];
  }
  if (state === 'modified') {
    return [
      `Its command references changed since ${shown(name)} skills install wrote them, so ${shown(name)} skills update will not replace it. Copy the changed files elsewhere to keep them, then run ${install} --force to replace the folder.`,
    ];
  }
  return [
    `Run ${shown(name)} skills update to bring it up to date, once no skill reads modified or unmanaged.`,
  ];
}
function statusNote(name: string, state: SkillState, scope: NoteScope): string[] {
  if (state === 'current') {
    return [];
  }
  return (scope.project ? projectNote : globalNote)(name, state, installStep(name, scope));
}
function statusRecordUnreadable(name: string, path: string): string {
  return `${shownPath(path)} cannot be read, so ${shown(name)} cannot tell which skills it installed. Remove it and the folders it lists, then run ${shown(name)} skills install again.`;
}
function statusSameFolder(name: string, agents: string, claude: string): string {
  return `${shownPath(agents)} is the same folder as ${shownPath(claude)}, so ${shown(name)} reports on it once, for claude.`;
}
function obsoleteSkill(name: string, folder: string, modified: boolean): string {
  return modified
    ? `${shown(name)} skills install recorded ${shownPath(folder)}, a skill this version no longer declares, and command references in it changed, so ${shown(name)} skills update will leave it in place. Copy what you want to keep, then remove the folder.`
    : `${shown(name)} skills install recorded ${shownPath(folder)}, a skill this version no longer declares. Run ${shown(name)} skills update to remove it, once no skill reads modified or unmanaged.`;
}
function statusProjectIsGlobal(name: string, folder: string): string {
  return `${shown(name)} skills status --project would read ${shownPath(folder)}, the folder ${shown(name)} skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project.`;
}

export {
  directoryMissing,
  directoryMissingIssue,
  directoryWithoutProject,
  directoryWithoutProjectIssue,
  folderGone,
  folderNotInstalled,
  folderUnchanged,
  installedSkill,
  installedSkillOver,
  noSkillsToRemove,
  noSkillsToUpdate,
  projectIsGlobal,
  recordUnreadable,
  removedFolder,
  replacedFolder,
  sameSkillsFolder,
  skillFileLeftOut,
  skillsInTheWay,
  skillsNotRefreshed,
  skillsRefreshSkipped,
  updatedSkill,
  referenceChanged,
  replacedModified,
  modifiedKept,
  statusNote,
  statusRecordUnreadable,
  statusSameFolder,
  obsoleteSkill,
  statusProjectIsGlobal,
};
