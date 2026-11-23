/*
 * The operator sentences of the completion plugin, under ADR-0164. `tests/message-voice.test.ts`
 * holds this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

const shown = escapeControlCharacters;

const shownPath = (path: string): string => nowrap(shown(path));

/** Why PowerShell could not answer with its profile, as the failure sentence states it. */
type ProfileFault =
  | { readonly kind: 'not-started' }
  | { readonly kind: 'exited'; readonly code: number }
  | { readonly kind: 'reported'; readonly answer: string };

function installShell(shell: string): string {
  return `Install ${shown(shell)}, or name the shell you use.`;
}

function shellExited(shell: string, code: number): string {
  return `${shown(shell)} exited with code ${String(code)}. ${installShell(shell)}`;
}

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

function scriptsInTheWay(name: string, verb: 'install' | 'update', shell: string): string {
  return `${shown(name)} completion ${shown(verb)} changed nothing, because files it did not install are in the way. Remove them, then run ${shown(name)} completion install ${shown(shell)} again.`;
}

function startupNotAFile(name: string, startup: string): string {
  return `${shownPath(startup)} is not a file, so ${shown(name)} cannot add its startup line. Remove it, then run ${shown(name)} completion install again.`;
}

function installsNotOnWindows(name: string, printer: string): string {
  return `${shown(name)} completion installs bash, zsh, fish, pwsh, and nu completion on Linux and macOS. Print the script with ${shown(name)} completion ${shown(printer)} and load it yourself.`;
}

function profileNotFound(name: string, shell: string, fault: ProfileFault): string {
  return `${shown(name)} cannot find the profile of ${shown(shell)}, because ${profileFault(shell, fault)}`;
}

function recordUnreadable(name: string, record: string, verb: 'install' | 'uninstall'): string {
  return `${shownPath(record)} cannot be read, so ${shown(name)} will not change the files and line it lists. Remove it, the files it lists, and the line it added, then run ${shown(name)} completion ${shown(verb)} again.`;
}

function shellUnknown(name: string, login: string | undefined): string {
  return `${shown(name)} cannot tell your shell from SHELL (${login === undefined ? '(unset)' : shown(login)}). Name it: ${shown(name)} completion install bash, zsh, fish, pwsh, or nu.`;
}

function addLineInPlace(startup: string): string {
  return `Add this line to ${shownPath(startup)} in its place:`;
}

function addLineYourself(name: string, startup: string): string {
  return `${shown(name)} cannot change ${shownPath(startup)}, so add this line to it yourself:`;
}

function addedLine(startup: string): string {
  return `Added a line to ${shownPath(startup)} that loads it.`;
}

function alreadyLoads(startup: string): string {
  return `${shownPath(startup)} already loads it.`;
}

function scriptChanged(name: string, script: string): string {
  return `${shownPath(script)} changed since ${shown(name)} completion install wrote it.`;
}

function scriptGone(script: string): string {
  return `${shownPath(script)} was already gone.`;
}

function installedScript(shell: string, script: string): string {
  return `Installed the ${shown(shell)} completion script in ${shownPath(script)}.`;
}

function scriptLeftInPlace(name: string, script: string): string {
  return `${shownPath(script)} changed since ${shown(name)} completion install wrote it, so it was left in place.`;
}

function lineNoLongerHeld(name: string, startup: string): string {
  return `${shownPath(startup)} no longer holds the line ${shown(name)} completion install added, so it was left as it is.`;
}

function noCompletionToRemove(name: string): string {
  return `${shown(name)} has no completion installed, so there is nothing to remove.`;
}

function noCompletionToUpdate(name: string): string {
  return `${shown(name)} has no completion installed, so there is nothing to update. Run ${shown(name)} completion install to install it.`;
}

function scriptNotInstalled(name: string, script: string): string {
  return `${shownPath(script)} was not installed by ${shown(name)} completion install.`;
}

const openNewShell = 'Open a new shell to use it.';

function removeLineYourself(name: string, startup: string): string {
  return `${shown(name)} cannot change ${shownPath(startup)}, so remove this line from it yourself:`;
}

function removedFile(path: string): string {
  return `Removed ${shownPath(path)}.`;
}

function removedLine(startup: string): string {
  return `Removed the line from ${shownPath(startup)}.`;
}

function scriptUnchanged(script: string): string {
  return `${shownPath(script)} is unchanged.`;
}

function updatedScript(shell: string, script: string): string {
  return `Updated the ${shown(shell)} completion script in ${shownPath(script)}.`;
}

function updatedLine(startup: string): string {
  return `Updated the line in ${shownPath(startup)}.`;
}

function completionNotRefreshed(path: string, name: string): string {
  return `Completion was not refreshed because ${shown(path)} could not start. Run ${shown(name)} completion update.\n`;
}

/** The `warn` event's message when a completer throws or rejects, with the completer and error as fields. */
const completerFailedEvent = 'A completer failed, so completion offered no values.';

/** The refresh's `-vv` line when the installation record holds none of the plugin's files. */
const completionRefreshSkipped = 'Skipped the completion refresh: nothing is installed.';

/** The `warn` log event of a refresh whose child failed or could not start. */
const completionRefreshFailed = 'Completion was not refreshed after the update.';

export type { ProfileFault };
export {
  addedLine,
  addLineInPlace,
  addLineYourself,
  alreadyLoads,
  completerFailedEvent,
  completionNotRefreshed,
  completionRefreshSkipped,
  completionRefreshFailed,
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
