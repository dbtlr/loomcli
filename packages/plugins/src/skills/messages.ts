/*
 * The operator sentences of the skills plugin, under ADR-0164. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

const shown = escapeControlCharacters;

const shownPath = (path: string): string => nowrap(shown(path));

function skillsInTheWay(name: string, verb: 'install' | 'update'): string {
  return `${shown(name)} skills ${shown(verb)} changed nothing, because folders it did not install are in the way. Remove them, or run ${shown(name)} skills install --force to replace them.`;
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

/** The refresh's `-v` line once its child exited 0. */
const skillsRefreshed = 'Refreshed the skills after the update.';

/** The refresh's `-vv` line when the installation record holds none of the plugin's files. */
const skillsRefreshSkipped = 'Skipped the skills refresh: nothing is installed.';

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
  skillsInTheWay,
  skillsNotRefreshed,
  skillsRefreshed,
  skillsRefreshSkipped,
  updatedSkill,
};
