/*
 * The operator sentences of the manpage plugin, under ADR-0164: the failures its children raise,
 * the lines they write about their work, and the line a refresh writes when the new binary cannot
 * start. Each is a function of the values it repeats, or a constant, and the code that raises the
 * failure or writes the line calls it. `tests/message-voice.test.ts` holds this module to the
 * failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

/** Every path and name a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/** A filesystem path escaped as a failure message quotes text, and kept whole when a lane wraps. */
const shownPath = (path: string): string => nowrap(shown(path));

/** The one count a sentence reads in the singular. */
const one = 1;

/** `1 man page`, or the count and `man pages` for every other count. */
function pages(count: number): string {
  return count === one ? '1 man page' : `${String(count)} man pages`;
}

/**
 * The Commands that write the pages, which a sentence names.
 *
 * @example
 * ```ts
 * const verb: WritingVerb = 'update';
 * ```
 */
type WritingVerb = 'install' | 'update';

/**
 * The failure of an install or update that other files are in the way of.
 *
 * @example
 * ```ts
 * pagesInTheWay('notes', 'install');
 * // 'notes manpage install changed nothing, because files it did not install are in the way. Remove them, then run notes manpage install again.'
 * ```
 */
function pagesInTheWay(name: string, verb: WritingVerb): string {
  return `${shown(name)} manpage ${shown(verb)} changed nothing, because files it did not install are in the way. Remove them, then run ${shown(name)} manpage install again.`;
}

/**
 * The failure of an update whose record lists pages in more than one folder.
 *
 * @example
 * ```ts
 * pagesInManyFolders('notes', '/home/ada/.local/state/notes/manpage.json');
 * ```
 */
function pagesInManyFolders(name: string, record: string): string {
  return `${shownPath(record)} lists man pages in more than one folder, so ${shown(name)} manpage update cannot tell where they belong. Run ${shown(name)} manpage install to put them in one folder.`;
}

/**
 * The failure of a folder path that names something other than a folder.
 *
 * @example
 * ```ts
 * notAFolder('notes', '/home/ada/notes.1');
 * // '/home/ada/notes.1 is not a folder. Name a folder, or a path where notes can create one.'
 * ```
 */
function notAFolder(name: string, folder: string): string {
  return `${shownPath(folder)} is not a folder. Name a folder, or a path where ${shown(name)} can create one.`;
}

/**
 * The failure of an installation record that cannot be read.
 *
 * @example
 * ```ts
 * recordUnreadable('notes', '/home/ada/.local/state/notes/manpage.json', 'uninstall');
 * ```
 */
function recordUnreadable(name: string, record: string, verb: 'install' | 'uninstall'): string {
  return `${shownPath(record)} cannot be read, so ${shown(name)} will not change the man pages it lists. Remove it and the pages it lists, then run ${shown(name)} manpage ${shown(verb)} again.`;
}

/**
 * The warning that `MANPATH` does not list the folder, before the line that adds it.
 *
 * @example
 * ```ts
 * manpathAdvice('/home/ada/.local/share/man');
 * ```
 */
function manpathAdvice(folder: string): string {
  return `man will not find these pages until MANPATH lists ${shownPath(folder)}. Add this line to your shell's startup file:`;
}

/**
 * The warning of a page someone changed since install wrote it.
 *
 * @example
 * ```ts
 * pageChanged('notes', '/home/ada/.local/share/man/man1/notes.1');
 * ```
 */
function pageChanged(name: string, file: string): string {
  return `${shownPath(file)} changed since ${shown(name)} manpage install wrote it.`;
}

/**
 * The confirmation of pages installed in a folder.
 *
 * @example
 * ```ts
 * installedPages(3, '/home/ada/.local/share/man'); // 'Installed 3 man pages in /home/ada/.local/share/man.'
 * ```
 */
function installedPages(count: number, folder: string): string {
  return `Installed ${pages(count)} in ${shownPath(folder)}.`;
}

/**
 * The warning of a changed page uninstall left in place.
 *
 * @example
 * ```ts
 * pageKept('notes', '/home/ada/.local/share/man/man1/notes.1');
 * ```
 */
function pageKept(name: string, file: string): string {
  return `${shownPath(file)} changed since ${shown(name)} manpage install wrote it, so it was left in place.`;
}

/**
 * The confirmation of an uninstall with no man pages installed.
 *
 * @example
 * ```ts
 * noPagesToRemove('notes'); // 'notes has no man pages installed, so there is nothing to remove.'
 * ```
 */
function noPagesToRemove(name: string): string {
  return `${shown(name)} has no man pages installed, so there is nothing to remove.`;
}

/**
 * The confirmation of an update with no man pages installed.
 *
 * @example
 * ```ts
 * noPagesToUpdate('notes');
 * ```
 */
function noPagesToUpdate(name: string): string {
  return `${shown(name)} has no man pages installed, so there is nothing to update. Run ${shown(name)} manpage install to install them.`;
}

/**
 * The warning of a file in the way that install did not write.
 *
 * @example
 * ```ts
 * pageNotInstalled('notes', '/home/ada/.local/share/man/man1/notes.1');
 * ```
 */
function pageNotInstalled(name: string, file: string): string {
  return `${shownPath(file)} was not installed by ${shown(name)} manpage install.`;
}

/**
 * The line that says how to read the installed pages.
 *
 * @example
 * ```ts
 * readWithMan('notes'); // 'Read them with man notes.'
 * ```
 */
function readWithMan(name: string): string {
  return `Read them with man ${shown(name)}.`;
}

/**
 * The line of a removed page.
 *
 * @example
 * ```ts
 * removedPage('/home/ada/.local/share/man/man1/notes.1');
 * ```
 */
function removedPage(file: string): string {
  return `Removed ${shownPath(file)}.`;
}

/**
 * The confirmation of pages removed from a folder.
 *
 * @example
 * ```ts
 * removedPages(1, '/home/ada/.local/share/man'); // 'Removed 1 man page from /home/ada/.local/share/man.'
 * ```
 */
function removedPages(count: number, folder: string): string {
  return `Removed ${pages(count)} from ${shownPath(folder)}.`;
}

/**
 * The line of pages that are already current.
 *
 * @example
 * ```ts
 * pagesUnchanged(2, '/home/ada/.local/share/man');
 * // 'The 2 man pages in /home/ada/.local/share/man are unchanged.'
 * ```
 */
function pagesUnchanged(count: number, folder: string): string {
  return `The ${pages(count)} in ${shownPath(folder)} ${count === one ? 'is' : 'are'} unchanged.`;
}

/**
 * The confirmation of pages updated in a folder.
 *
 * @example
 * ```ts
 * updatedPages(3, '/home/ada/.local/share/man');
 * ```
 */
function updatedPages(count: number, folder: string): string {
  return `Updated ${pages(count)} in ${shownPath(folder)}.`;
}

/**
 * The confirmation of pages written to a folder.
 *
 * @example
 * ```ts
 * wrotePages(3, 'man'); // 'Wrote 3 man pages to man.'
 * ```
 */
function wrotePages(count: number, folder: string): string {
  return `Wrote ${pages(count)} to ${shownPath(folder)}.`;
}

/**
 * The line a refresh writes when the new binary cannot start, with the update to run by hand.
 *
 * @example
 * ```ts
 * manpagesNotRefreshed('/usr/local/bin/notes', 'notes');
 * // 'The man pages were not refreshed because /usr/local/bin/notes could not start. Run notes manpage update.\n'
 * ```
 */
function manpagesNotRefreshed(path: string, name: string): string {
  return `The man pages were not refreshed because ${shown(path)} could not start. Run ${shown(name)} manpage update.\n`;
}

export type { WritingVerb };
export {
  installedPages,
  manpagesNotRefreshed,
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
