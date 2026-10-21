import { escapeControlCharacters, FatalError, nowrap } from '@loomcli/core';

/** Every path and name a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/** A filesystem path escaped as a failure message quotes text, and kept whole when a lane wraps. */
const shownPath = (path: string): string => nowrap(shown(path));

/** The one count a sentence reads in the singular. */
const one = 1;

/** `1 man page`, or the count and `man pages` for every other count. */
function pages(count: number): string {
  return count === one ? '1 man page' : `${count} man pages`;
}

/** The Commands that write the pages, which a sentence names. */
type WritingVerb = 'install' | 'update';

const refusals = {
  inTheWay: (name: string, verb: WritingVerb) =>
    new FatalError(
      `${shown(name)} manpage ${verb} changed nothing, because files it did not install are in the way. Remove them, then run ${shown(name)} manpage install again.`,
    ),
  manyFolders: (name: string, record: string) =>
    new FatalError(
      `${shownPath(record)} lists man pages in more than one folder, so ${shown(name)} manpage update cannot tell where they belong. Run ${shown(name)} manpage install to put them in one folder.`,
    ),
  notFolder: (name: string, folder: string) =>
    new FatalError(
      `${shownPath(folder)} is not a folder. Name a folder, or a path where ${shown(name)} can create one.`,
    ),
  record: (name: string, record: string, verb: 'install' | 'uninstall') =>
    new FatalError(
      `${shownPath(record)} cannot be read, so ${shown(name)} will not change the man pages it lists. Remove it and the pages it lists, then run ${shown(name)} manpage ${verb} again.`,
    ),
};

/** The lines each child writes about its work. */
const lines = {
  advice: (folder: string) =>
    `man will not find these pages until MANPATH lists ${shownPath(folder)}. Add this line to your shell's startup file:`,
  changed: (name: string, file: string) =>
    `${shownPath(file)} changed since ${shown(name)} manpage install wrote it.`,
  installed: (count: number, folder: string) =>
    `Installed ${pages(count)} in ${shownPath(folder)}.`,
  kept: (name: string, file: string) =>
    `${shownPath(file)} changed since ${shown(name)} manpage install wrote it, so it was left in place.`,
  noneToRemove: (name: string) =>
    `${shown(name)} has no man pages installed, so there is nothing to remove.`,
  noneToUpdate: (name: string) =>
    `${shown(name)} has no man pages installed, so there is nothing to update. Run ${shown(name)} manpage install to install them.`,
  notInstalled: (name: string, file: string) =>
    `${shownPath(file)} was not installed by ${shown(name)} manpage install.`,
  read: (name: string) => `Read them with man ${shown(name)}.`,
  removed: (file: string) => `Removed ${shownPath(file)}.`,
  removedFrom: (count: number, folder: string) =>
    `Removed ${pages(count)} from ${shownPath(folder)}.`,
  unchanged: (count: number, folder: string) =>
    `The ${pages(count)} in ${shownPath(folder)} ${count === one ? 'is' : 'are'} unchanged.`,
  updated: (count: number, folder: string) => `Updated ${pages(count)} in ${shownPath(folder)}.`,
  wrote: (count: number, folder: string) => `Wrote ${pages(count)} to ${shownPath(folder)}.`,
};

export type { WritingVerb };
export { lines, refusals };
