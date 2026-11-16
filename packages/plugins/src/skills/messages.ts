/*
 * The operator sentences of the skills plugin, under ADR-0164: the failures its children raise,
 * the issues of the `--directory` option, the lines the children write about their work, and the
 * line a refresh writes when the new binary cannot start. Each is a function of the values it
 * repeats, or a constant, and the code that raises the failure or writes the line calls it.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

/** Every path, folder, and name a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/** A filesystem path escaped as a failure message quotes text, and kept whole when a lane wraps. */
const shownPath = (path: string): string => nowrap(shown(path));

/**
 * The failure of an install or update that other folders are in the way of.
 *
 * @example
 * ```ts
 * skillsInTheWay('notes', 'install');
 * ```
 */
function skillsInTheWay(name: string, verb: 'install' | 'update'): string {
  return `${shown(name)} skills ${shown(verb)} changed nothing, because folders it did not install are in the way. Remove them, or run ${shown(name)} skills install --force to replace them.`;
}

/**
 * The failure of a project install that would write to the folder kept for the home folder.
 *
 * @example
 * ```ts
 * projectIsGlobal('notes', '/home/ada/.claude/skills');
 * ```
 */
function projectIsGlobal(name: string, folder: string): string {
  return `${shown(name)} skills install --project would write to ${shownPath(folder)}, the folder ${shown(name)} skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project.`;
}

/**
 * The failure of an installation record that cannot be read.
 *
 * @example
 * ```ts
 * recordUnreadable('notes', '/home/ada/.local/state/notes/skills.json', 'install');
 * ```
 */
function recordUnreadable(name: string, record: string, verb: 'install' | 'uninstall'): string {
  return `${shownPath(record)} cannot be read, so ${shown(name)} will not change the folders it lists. Remove it and the folders it lists, then run ${shown(name)} skills ${shown(verb)} again.`;
}

/**
 * The issue of `--directory` given without `--project`.
 *
 * @example
 * ```ts
 * console.log(directoryWithoutProjectIssue); // 'Add --project, or leave out --directory.'
 * ```
 */
const directoryWithoutProjectIssue = 'Add --project, or leave out --directory.';

/**
 * The failure of `--directory` given without `--project`.
 *
 * @example
 * ```ts
 * console.log(directoryWithoutProject);
 * // 'Option "--directory" needs --project. Add --project, or leave out --directory.'
 * ```
 */
const directoryWithoutProject =
  'Option "--directory" needs --project. Add --project, or leave out --directory.';

/**
 * The issue of a `--directory` that names no directory.
 *
 * @example
 * ```ts
 * console.log(directoryMissingIssue); // 'Name a directory that exists.'
 * ```
 */
const directoryMissingIssue = 'Name a directory that exists.';

/**
 * The failure of a `--directory` that names no directory.
 *
 * @example
 * ```ts
 * directoryMissing('/home/ada/nowhere');
 * // 'Option "--directory" names /home/ada/nowhere, which is not a directory. Name a directory that exists.'
 * ```
 */
function directoryMissing(start: string): string {
  return `Option "--directory" names ${shown(start)}, which is not a directory. Name a directory that exists.`;
}

/**
 * The line of a recorded folder that was already gone.
 *
 * @example
 * ```ts
 * folderGone('/home/ada/.claude/skills/notes');
 * ```
 */
function folderGone(folder: string): string {
  return `${shownPath(folder)} was already gone.`;
}

/**
 * The confirmation of a skill installed for one target.
 *
 * @example
 * ```ts
 * installedSkill('notes', 'claude', '/home/ada/.claude/skills/notes');
 * ```
 */
function installedSkill(name: string, target: string, folder: string): string {
  return `Installed ${shown(name)} for ${shown(target)} in ${shownPath(folder)}.`;
}

/**
 * The confirmation of a skill a project install wrote over the copy that was there.
 *
 * @example
 * ```ts
 * installedSkillOver('notes', 'claude', '/work/notes/.claude/skills/notes');
 * ```
 */
function installedSkillOver(name: string, target: string, folder: string): string {
  return `Installed ${shown(name)} for ${shown(target)} in ${shownPath(folder)}, replacing the copy that was there.`;
}

/**
 * The confirmation of an uninstall with no skills installed.
 *
 * @example
 * ```ts
 * noSkillsToRemove('notes');
 * ```
 */
function noSkillsToRemove(name: string): string {
  return `${shown(name)} has no skills installed in your home folder, so there is nothing to remove.`;
}

/**
 * The confirmation of an update with no skills installed.
 *
 * @example
 * ```ts
 * noSkillsToUpdate('notes');
 * ```
 */
function noSkillsToUpdate(name: string): string {
  return `${shown(name)} has no skills installed in your home folder, so there is nothing to update. Run ${shown(name)} skills install to install them.`;
}

/**
 * The warning of a folder in the way that install did not write.
 *
 * @example
 * ```ts
 * folderNotInstalled('notes', '/home/ada/.claude/skills/notes');
 * ```
 */
function folderNotInstalled(name: string, folder: string): string {
  return `${shownPath(folder)} was not installed by ${shown(name)} skills install.`;
}

/**
 * The line of a removed folder.
 *
 * @example
 * ```ts
 * removedFolder('/home/ada/.claude/skills/notes'); // 'Removed /home/ada/.claude/skills/notes.'
 * ```
 */
function removedFolder(folder: string): string {
  return `Removed ${shownPath(folder)}.`;
}

/**
 * The line of a folder `--force` replaced.
 *
 * @example
 * ```ts
 * replacedFolder('notes', '/home/ada/.claude/skills/notes');
 * ```
 */
function replacedFolder(name: string, folder: string): string {
  return `Replaced ${shownPath(folder)}, which ${shown(name)} skills install did not install.`;
}

/**
 * The line of two targets that resolve to one folder.
 *
 * @example
 * ```ts
 * sameSkillsFolder('notes', '/home/ada/.agents/skills', '/home/ada/.claude/skills');
 * ```
 */
function sameSkillsFolder(name: string, agents: string, claude: string): string {
  return `${shownPath(agents)} is the same folder as ${shownPath(claude)}, so ${shown(name)} acts on it once, for claude.`;
}

/**
 * The line of a skill folder that is already current.
 *
 * @example
 * ```ts
 * folderUnchanged('/home/ada/.claude/skills/notes'); // '/home/ada/.claude/skills/notes is unchanged.'
 * ```
 */
function folderUnchanged(folder: string): string {
  return `${shownPath(folder)} is unchanged.`;
}

/**
 * The confirmation of a skill updated for one target.
 *
 * @example
 * ```ts
 * updatedSkill('notes', 'agents', '/home/ada/.agents/skills/notes');
 * ```
 */
function updatedSkill(name: string, target: string, folder: string): string {
  return `Updated ${shown(name)} for ${shown(target)} in ${shownPath(folder)}.`;
}

/**
 * The line a refresh writes when the new binary cannot start, with the update to run by hand.
 *
 * @example
 * ```ts
 * skillsNotRefreshed('/usr/local/bin/notes', 'notes');
 * // 'The skills were not refreshed because /usr/local/bin/notes could not start. Run notes skills update.\n'
 * ```
 */
function skillsNotRefreshed(path: string, name: string): string {
  return `The skills were not refreshed because ${shown(path)} could not start. Run ${shown(name)} skills update.\n`;
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
  skillsInTheWay,
  skillsNotRefreshed,
  updatedSkill,
};
