/*
 * The operator sentences of the manpage plugin, under ADR-0164. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

const shown = escapeControlCharacters;

const shownPath = (path: string): string => nowrap(shown(path));

const one = 1;

/** `1 man page`, or the count and `man pages` for every other count. */
function pages(count: number): string {
  return count === one ? '1 man page' : `${String(count)} man pages`;
}

type WritingVerb = 'install' | 'update';

function pagesInTheWay(name: string, verb: WritingVerb): string {
  return `${shown(name)} manpage ${shown(verb)} changed nothing, because files it did not install are in the way. Remove them, then run ${shown(name)} manpage install again.`;
}

function pagesInManyFolders(name: string, record: string): string {
  return `${shownPath(record)} lists man pages in more than one folder, so ${shown(name)} manpage update cannot tell where they belong. Run ${shown(name)} manpage install to put them in one folder.`;
}

function notAFolder(name: string, folder: string): string {
  return `${shownPath(folder)} is not a folder. Name a folder, or a path where ${shown(name)} can create one.`;
}

function recordUnreadable(name: string, record: string, verb: 'install' | 'uninstall'): string {
  return `${shownPath(record)} cannot be read, so ${shown(name)} will not change the man pages it lists. Remove it and the pages it lists, then run ${shown(name)} manpage ${shown(verb)} again.`;
}

function manpathAdvice(folder: string): string {
  return `man will not find these pages until MANPATH lists ${shownPath(folder)}. Add this line to your shell's startup file:`;
}

function pageChanged(name: string, file: string): string {
  return `${shownPath(file)} changed since ${shown(name)} manpage install wrote it.`;
}

function installedPages(count: number, folder: string): string {
  return `Installed ${pages(count)} in ${shownPath(folder)}.`;
}

function pageKept(name: string, file: string): string {
  return `${shownPath(file)} changed since ${shown(name)} manpage install wrote it, so it was left in place.`;
}

function noPagesToRemove(name: string): string {
  return `${shown(name)} has no man pages installed, so there is nothing to remove.`;
}

function noPagesToUpdate(name: string): string {
  return `${shown(name)} has no man pages installed, so there is nothing to update. Run ${shown(name)} manpage install to install them.`;
}

function pageNotInstalled(name: string, file: string): string {
  return `${shownPath(file)} was not installed by ${shown(name)} manpage install.`;
}

function readWithMan(name: string): string {
  return `Read them with man ${shown(name)}.`;
}

function removedPage(file: string): string {
  return `Removed ${shownPath(file)}.`;
}

function removedPages(count: number, folder: string): string {
  return `Removed ${pages(count)} from ${shownPath(folder)}.`;
}

function pagesUnchanged(count: number, folder: string): string {
  return `The ${pages(count)} in ${shownPath(folder)} ${count === one ? 'is' : 'are'} unchanged.`;
}

function updatedPages(count: number, folder: string): string {
  return `Updated ${pages(count)} in ${shownPath(folder)}.`;
}

function wrotePages(count: number, folder: string): string {
  return `Wrote ${pages(count)} to ${shownPath(folder)}.`;
}

function manpagesNotRefreshed(path: string, name: string): string {
  return `The man pages were not refreshed because ${shown(path)} could not start. Run ${shown(name)} manpage update.\n`;
}

/** The refresh's `-vv` line when the installation record holds none of the plugin's files. */
const manpagesRefreshSkipped = 'Skipped the man page refresh: nothing is installed.';

/** The `warn` log event of a refresh whose child failed or could not start. */
const manpagesRefreshFailed = 'Man pages were not refreshed after the update.';

export type { WritingVerb };
export {
  installedPages,
  manpagesNotRefreshed,
  manpagesRefreshSkipped,
  manpagesRefreshFailed,
  manpathAdvice,
  noPagesToRemove,
  noPagesToUpdate,
  notAFolder,
  pageChanged,
  pageKept,
  pageNotInstalled,
  pagesInManyFolders,
  pagesInTheWay,
  pagesUnchanged,
  readWithMan,
  recordUnreadable,
  removedPage,
  removedPages,
  updatedPages,
  wrotePages,
};
