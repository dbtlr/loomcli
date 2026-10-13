import { escapeControlCharacters, FatalError } from '@loomcli/core';

/** Every path and name a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

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
      `${shown(record)} lists man pages in more than one folder, so ${shown(name)} manpage update cannot tell where they belong. Run ${shown(name)} manpage install to put them in one folder.`,
    ),
  notFolder: (name: string, folder: string) =>
    new FatalError(
      `${shown(folder)} is not a folder. Name a folder, or a path where ${shown(name)} can create one.`,
    ),
  record: (name: string, record: string, verb: 'install' | 'uninstall') =>
    new FatalError(
      `${shown(record)} cannot be read, so ${shown(name)} will not change the man pages it lists. Remove it and the pages it lists, then run ${shown(name)} manpage ${verb} again.`,
    ),
  windows: (name: string) =>
    new FatalError(
      `${shown(name)} manpage install works on Linux and macOS, which have man. Write the pages with ${shown(name)} manpage generate --out <folder> instead.`,
    ),
};

/** The lines each child writes about its work. */
const lines = {
  advice: (folder: string) =>
    `man will not find these pages until MANPATH lists ${shown(folder)}. Add this line to your shell's startup file:`,
  changed: (name: string, file: string) =>
    `${shown(file)} changed since ${shown(name)} manpage install wrote it.`,
  installed: (count: number, folder: string) => `Installed ${pages(count)} in ${shown(folder)}.`,
  kept: (name: string, file: string) =>
    `${shown(file)} changed since ${shown(name)} manpage install wrote it, so it was left in place.`,
  noneToRemove: (name: string) =>
    `${shown(name)} has no man pages installed, so there is nothing to remove.`,
  noneToUpdate: (name: string) =>
    `${shown(name)} has no man pages installed, so there is nothing to update. Run ${shown(name)} manpage install to install them.`,
  notInstalled: (name: string, file: string) =>
    `${shown(file)} was not installed by ${shown(name)} manpage install.`,
  read: (name: string) => `Read them with man ${shown(name)}.`,
  removed: (file: string) => `Removed ${shown(file)}.`,
  removedFrom: (count: number, folder: string) => `Removed ${pages(count)} from ${shown(folder)}.`,
  unchanged: (count: number, folder: string) =>
    `The ${pages(count)} in ${shown(folder)} ${count === one ? 'is' : 'are'} unchanged.`,
  updated: (count: number, folder: string) => `Updated ${pages(count)} in ${shown(folder)}.`,
  wrote: (count: number, folder: string) => `Wrote ${pages(count)} to ${shown(folder)}.`,
};

export type { WritingVerb };
export { lines, refusals };
