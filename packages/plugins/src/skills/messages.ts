import { escapeControlCharacters, FatalError, nowrap } from '@loomcli/core';

/** Every path, folder, and name a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/** A filesystem path escaped as a failure message quotes text, and kept whole when a lane wraps. */
const shownPath = (path: string): string => nowrap(shown(path));

/** One failure a child reports, which exits 1. */
function fatal(sentence: string): FatalError {
  return new FatalError(sentence);
}

const refusals = {
  inTheWay: (name: string, verb: 'install' | 'update') =>
    fatal(
      `${shown(name)} skills ${verb} changed nothing, because folders it did not install are in the way. Remove them, or run ${shown(name)} skills install --force to replace them.`,
    ),
  neverGlobal: (name: string, folder: string) =>
    fatal(
      `${shown(name)} skills install --project would write to ${shownPath(folder)}, the folder ${shown(name)} skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project.`,
    ),
  record: (name: string, record: string, verb: 'install' | 'uninstall') =>
    fatal(
      `${shownPath(record)} cannot be read, so ${shown(name)} will not change the folders it lists. Remove it and the folders it lists, then run ${shown(name)} skills ${verb} again.`,
    ),
};

/** The lines each child writes about its work. */
const lines = {
  gone: (folder: string) => `${shownPath(folder)} was already gone.`,
  installed: (name: string, target: string, folder: string) =>
    `Installed ${shown(name)} for ${target} in ${shownPath(folder)}.`,
  installedOver: (name: string, target: string, folder: string) =>
    `Installed ${shown(name)} for ${target} in ${shownPath(folder)}, replacing the copy that was there.`,
  noneToRemove: (name: string) =>
    `${shown(name)} has no skills installed in your home folder, so there is nothing to remove.`,
  noneToUpdate: (name: string) =>
    `${shown(name)} has no skills installed in your home folder, so there is nothing to update. Run ${shown(name)} skills install to install them.`,
  notInstalled: (name: string, folder: string) =>
    `${shownPath(folder)} was not installed by ${shown(name)} skills install.`,
  removed: (folder: string) => `Removed ${shownPath(folder)}.`,
  replaced: (name: string, folder: string) =>
    `Replaced ${shownPath(folder)}, which ${shown(name)} skills install did not install.`,
  sameFolder: (name: string, agents: string, claude: string) =>
    `${shownPath(agents)} is the same folder as ${shownPath(claude)}, so ${shown(name)} acts on it once, for claude.`,
  unchanged: (folder: string) => `${shownPath(folder)} is unchanged.`,
  updated: (name: string, target: string, folder: string) =>
    `Updated ${shown(name)} for ${target} in ${shownPath(folder)}.`,
};

export { lines, refusals, shown };
