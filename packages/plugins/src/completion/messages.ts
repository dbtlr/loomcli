/*
 * The operator sentences of the completion plugin, under ADR-0164: the failures its children raise,
 * the lines they write about their work, and the line a refresh writes when the new binary cannot
 * start. Each is a function of the values it repeats, or a constant, and the code that raises the
 * failure or writes the line calls it. `tests/message-voice.test.ts` holds this module to the
 * failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

/** Every path, name, shell, and answer a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/** A filesystem path escaped as a failure message quotes text, and kept whole when a lane wraps. */
const shownPath = (path: string): string => nowrap(shown(path));

/**
 * Why PowerShell could not answer with its profile, as the failure sentence states it.
 *
 * @example
 * ```ts
 * const fault: ProfileFault = { code: 1, kind: 'exited' };
 * ```
 */
type ProfileFault =
  | { readonly kind: 'not-started' }
  | { readonly kind: 'exited'; readonly code: number }
  | { readonly kind: 'reported'; readonly answer: string };

/** The correction of a shell that could not answer. */
function installShell(shell: string): string {
  return `Install ${shown(shell)}, or name the shell you use.`;
}

/** The clause of a shell that exited with a code. */
function shellExited(shell: string, code: number): string {
  return `${shown(shell)} exited with code ${String(code)}. ${installShell(shell)}`;
}

/** The clause and the correction of a profile failure. */
function profileFault(shell: string, fault: ProfileFault): string {
  switch (fault.kind) {
    case 'not-started': {
      return `${shown(shell)} could not start. ${installShell(shell)}`;
    }
    case 'exited': {
      return shellExited(shell, fault.code);
    }
    default: {
      return `${shown(shell)} reported ${shown(fault.answer)}. Check that ${shown(shell)} -NoProfile -Command $PROFILE prints the path of your profile.`;
    }
  }
}

/**
 * The failure of an install or update that other files are in the way of.
 *
 * @example
 * ```ts
 * scriptsInTheWay('notes', 'install', 'bash');
 * // 'notes completion install changed nothing, because files it did not install are in the way. Remove them, then run notes completion install bash again.'
 * ```
 */
function scriptsInTheWay(name: string, verb: 'install' | 'update', shell: string): string {
  return `${shown(name)} completion ${shown(verb)} changed nothing, because files it did not install are in the way. Remove them, then run ${shown(name)} completion install ${shown(shell)} again.`;
}

/**
 * The failure of a startup path that is not a file.
 *
 * @example
 * ```ts
 * startupNotAFile('notes', '/home/ada/.bashrc');
 * ```
 */
function startupNotAFile(name: string, startup: string): string {
  return `${shownPath(startup)} is not a file, so ${shown(name)} cannot add its startup line. Remove it, then run ${shown(name)} completion install again.`;
}

/**
 * The failure of an installing child on Windows, naming the print Command to run instead.
 *
 * @example
 * ```ts
 * installsNotOnWindows('notes', 'powershell');
 * ```
 */
function installsNotOnWindows(name: string, printer: string): string {
  return `${shown(name)} completion installs bash, zsh, fish, and pwsh completion on Linux and macOS. Print the script with ${shown(name)} completion ${shown(printer)} and load it yourself.`;
}

/**
 * The failure of a shell whose profile cannot be found.
 *
 * @example
 * ```ts
 * profileNotFound('notes', 'pwsh', { kind: 'not-started' });
 * // 'notes cannot find the profile of pwsh, because pwsh could not start. Install pwsh, or name the shell you use.'
 * ```
 */
function profileNotFound(name: string, shell: string, fault: ProfileFault): string {
  return `${shown(name)} cannot find the profile of ${shown(shell)}, because ${profileFault(shell, fault)}`;
}

/**
 * The failure of an installation record that cannot be read.
 *
 * @example
 * ```ts
 * recordUnreadable('notes', '/home/ada/.local/state/notes/completion.bash.json', 'install');
 * ```
 */
function recordUnreadable(name: string, record: string, verb: 'install' | 'uninstall'): string {
  return `${shownPath(record)} cannot be read, so ${shown(name)} will not change the files and line it lists. Remove it, the files it lists, and the line it added, then run ${shown(name)} completion ${shown(verb)} again.`;
}

/**
 * The failure of an install that cannot tell the operator's shell from `SHELL`.
 *
 * @example
 * ```ts
 * shellUnknown('notes', '/bin/tcsh');
 * // 'notes cannot tell your shell from SHELL (/bin/tcsh). Name it: notes completion install bash, zsh, fish, or pwsh.'
 * ```
 */
function shellUnknown(name: string, login: string | undefined): string {
  return `${shown(name)} cannot tell your shell from SHELL (${login === undefined ? '(unset)' : shown(login)}). Name it: ${shown(name)} completion install bash, zsh, fish, or pwsh.`;
}

/**
 * The notice to put a startup line in place of the one there.
 *
 * @example
 * ```ts
 * addLineInPlace('/home/ada/.bashrc'); // 'Add this line to /home/ada/.bashrc in its place:'
 * ```
 */
function addLineInPlace(startup: string): string {
  return `Add this line to ${shownPath(startup)} in its place:`;
}

/**
 * The notice to add a startup line the plugin cannot add itself.
 *
 * @example
 * ```ts
 * addLineYourself('notes', '/home/ada/.bashrc');
 * ```
 */
function addLineYourself(name: string, startup: string): string {
  return `${shown(name)} cannot change ${shownPath(startup)}, so add this line to it yourself:`;
}

/**
 * The confirmation of an added startup line.
 *
 * @example
 * ```ts
 * addedLine('/home/ada/.bashrc'); // 'Added a line to /home/ada/.bashrc that loads it.'
 * ```
 */
function addedLine(startup: string): string {
  return `Added a line to ${shownPath(startup)} that loads it.`;
}

/**
 * The line of a startup file that already loads the script.
 *
 * @example
 * ```ts
 * alreadyLoads('/home/ada/.bashrc'); // '/home/ada/.bashrc already loads it.'
 * ```
 */
function alreadyLoads(startup: string): string {
  return `${shownPath(startup)} already loads it.`;
}

/**
 * The warning of a script someone changed since install wrote it.
 *
 * @example
 * ```ts
 * scriptChanged('notes', '/home/ada/.local/share/bash-completion/completions/notes');
 * ```
 */
function scriptChanged(name: string, script: string): string {
  return `${shownPath(script)} changed since ${shown(name)} completion install wrote it.`;
}

/**
 * The line of a recorded script that was already gone.
 *
 * @example
 * ```ts
 * scriptGone('/home/ada/.config/fish/completions/notes.fish');
 * ```
 */
function scriptGone(script: string): string {
  return `${shownPath(script)} was already gone.`;
}

/**
 * The confirmation of an installed script.
 *
 * @example
 * ```ts
 * installedScript('bash', '/home/ada/.local/share/bash-completion/completions/notes');
 * ```
 */
function installedScript(shell: string, script: string): string {
  return `Installed the ${shown(shell)} completion script in ${shownPath(script)}.`;
}

/**
 * The warning of a changed script uninstall left in place.
 *
 * @example
 * ```ts
 * scriptLeftInPlace('notes', '/home/ada/.config/fish/completions/notes.fish');
 * ```
 */
function scriptLeftInPlace(name: string, script: string): string {
  return `${shownPath(script)} changed since ${shown(name)} completion install wrote it, so it was left in place.`;
}

/**
 * The line of a startup file that no longer holds the recorded line.
 *
 * @example
 * ```ts
 * lineNoLongerHeld('notes', '/home/ada/.bashrc');
 * ```
 */
function lineNoLongerHeld(name: string, startup: string): string {
  return `${shownPath(startup)} no longer holds the line ${shown(name)} completion install added, so it was left as it is.`;
}

/**
 * The confirmation of an uninstall with no completion installed.
 *
 * @example
 * ```ts
 * noCompletionToRemove('notes');
 * // 'notes has no completion installed, so there is nothing to remove.'
 * ```
 */
function noCompletionToRemove(name: string): string {
  return `${shown(name)} has no completion installed, so there is nothing to remove.`;
}

/**
 * The confirmation of an update with no completion installed.
 *
 * @example
 * ```ts
 * noCompletionToUpdate('notes');
 * ```
 */
function noCompletionToUpdate(name: string): string {
  return `${shown(name)} has no completion installed, so there is nothing to update. Run ${shown(name)} completion install to install it.`;
}

/**
 * The warning of a file in the way that install did not write.
 *
 * @example
 * ```ts
 * scriptNotInstalled('notes', '/home/ada/.config/fish/completions/notes.fish');
 * ```
 */
function scriptNotInstalled(name: string, script: string): string {
  return `${shownPath(script)} was not installed by ${shown(name)} completion install.`;
}

/**
 * The line after an install that a new shell loads.
 *
 * @example
 * ```ts
 * console.log(openNewShell); // 'Open a new shell to use it.'
 * ```
 */
const openNewShell = 'Open a new shell to use it.';

/**
 * The notice to remove a released startup line the plugin cannot change.
 *
 * @example
 * ```ts
 * removeLineYourself('notes', '/home/ada/.bashrc');
 * ```
 */
function removeLineYourself(name: string, startup: string): string {
  return `${shown(name)} cannot change ${shownPath(startup)}, so remove this line from it yourself:`;
}

/**
 * The line of a removed file.
 *
 * @example
 * ```ts
 * removedFile('/home/ada/.config/fish/completions/notes.fish');
 * ```
 */
function removedFile(path: string): string {
  return `Removed ${shownPath(path)}.`;
}

/**
 * The line of a removed startup line.
 *
 * @example
 * ```ts
 * removedLine('/home/ada/.bashrc'); // 'Removed the line from /home/ada/.bashrc.'
 * ```
 */
function removedLine(startup: string): string {
  return `Removed the line from ${shownPath(startup)}.`;
}

/**
 * The line of a script that is already current.
 *
 * @example
 * ```ts
 * scriptUnchanged('/home/ada/.config/fish/completions/notes.fish');
 * ```
 */
function scriptUnchanged(script: string): string {
  return `${shownPath(script)} is unchanged.`;
}

/**
 * The confirmation of an updated script.
 *
 * @example
 * ```ts
 * updatedScript('fish', '/home/ada/.config/fish/completions/notes.fish');
 * ```
 */
function updatedScript(shell: string, script: string): string {
  return `Updated the ${shown(shell)} completion script in ${shownPath(script)}.`;
}

/**
 * The confirmation of an updated startup line.
 *
 * @example
 * ```ts
 * updatedLine('/home/ada/.bashrc'); // 'Updated the line in /home/ada/.bashrc.'
 * ```
 */
function updatedLine(startup: string): string {
  return `Updated the line in ${shownPath(startup)}.`;
}

/**
 * The line a refresh writes when the new binary cannot start, with the update to run by hand.
 *
 * @example
 * ```ts
 * completionNotRefreshed('/usr/local/bin/notes', 'notes');
 * // 'Completion was not refreshed because /usr/local/bin/notes could not start. Run notes completion update.\n'
 * ```
 */
function completionNotRefreshed(path: string, name: string): string {
  return `Completion was not refreshed because ${shown(path)} could not start. Run ${shown(name)} completion update.\n`;
}

export type { ProfileFault };
export {
  addedLine,
  addLineInPlace,
  addLineYourself,
  alreadyLoads,
  completionNotRefreshed,
  installedScript,
  installsNotOnWindows,
  lineNoLongerHeld,
  noCompletionToRemove,
  noCompletionToUpdate,
  openNewShell,
  profileNotFound,
  recordUnreadable,
  removedFile,
  removedLine,
  removeLineYourself,
  scriptChanged,
  scriptGone,
  scriptLeftInPlace,
  scriptNotInstalled,
  scriptsInTheWay,
  scriptUnchanged,
  shellUnknown,
  startupNotAFile,
  updatedLine,
  updatedScript,
};
