import { escapeControlCharacters, FatalError, InputError } from '@loomcli/core';

/** Every path, name, and answer a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/** One failure a child reports, which exits 1. */
function fatal(sentence: string): FatalError {
  return new FatalError(sentence);
}

/** Why PowerShell could not answer with its profile, as the failure sentence states it. */
type ProfileFault =
  | { readonly kind: 'not-started' }
  | { readonly kind: 'exited'; readonly code: number }
  | { readonly kind: 'reported'; readonly answer: string };

/** The clause and the correction of a profile failure. */
function profileFault(shell: string, fault: ProfileFault): string {
  const install = `Install ${shell}, or name the shell you use.`;
  switch (fault.kind) {
    case 'not-started': {
      return `${shell} could not start. ${install}`;
    }
    case 'exited': {
      return `${shell} exited with code ${fault.code}. ${install}`;
    }
    default: {
      return `${shell} reported ${shown(fault.answer)}. Check that ${shell} -NoProfile -Command $PROFILE prints the path of your profile.`;
    }
  }
}

const refusals = {
  controlCharacter: (name: string, path: string) =>
    fatal(
      `The path ${shown(path)} holds a control character, so ${shown(name)} cannot write it into a startup line. Choose a data folder without one.`,
    ),
  inTheWay: (name: string, verb: 'install' | 'update', shell: string) =>
    fatal(
      `${shown(name)} completion ${verb} changed nothing, because files it did not install are in the way. Remove them, then run ${shown(name)} completion install ${shell} again.`,
    ),
  notAFile: (name: string, startup: string) =>
    fatal(
      `${shown(startup)} is not a file, so ${shown(name)} cannot add its startup line. Remove it, then run ${shown(name)} completion install again.`,
    ),
  notOnWindows: (name: string, shell: string) =>
    fatal(
      `${shown(name)} completion install installs bash, zsh, and fish completion on Linux and macOS. Print the script with ${shown(name)} completion ${shell} and load it yourself.`,
    ),
  profile: (name: string, shell: string, fault: ProfileFault) =>
    fatal(
      `${shown(name)} cannot find the profile of ${shell}, because ${profileFault(shell, fault)}`,
    ),
  record: (name: string, record: string, verb: 'install' | 'uninstall') =>
    fatal(
      `${shown(record)} cannot be read, so ${shown(name)} will not change the files and line it lists. Remove it, the files it lists, and the line it added, then run ${shown(name)} completion ${verb} again.`,
    ),
  unknownShell: (name: string, login: string | undefined) => {
    const value = login === undefined ? '(unset)' : shown(login);
    return new InputError(
      `${shown(name)} cannot tell your shell from SHELL (${value}). Name it: ${shown(name)} completion install bash, zsh, fish, powershell, or pwsh.`,
      [
        {
          input: { global: false, kind: 'argument', name: 'shell' },
          reason: 'missing',
          spelling: 'shell',
        },
      ],
    );
  },
};

/** The lines each child writes about its work. */
const lines = {
  addInPlace: (startup: string) => `Add this line to ${shown(startup)} in its place:`,
  addYourself: (name: string, startup: string) =>
    `${shown(name)} cannot change ${shown(startup)}, so add this line to it yourself:`,
  added: (startup: string) => `Added a line to ${shown(startup)} that loads it.`,
  alreadyLoads: (startup: string) => `${shown(startup)} already loads it.`,
  changed: (name: string, script: string) =>
    `${shown(script)} changed since ${shown(name)} completion install wrote it.`,
  gone: (script: string) => `${shown(script)} was already gone.`,
  installed: (shell: string, script: string) =>
    `Installed the ${shell} completion script in ${shown(script)}.`,
  leftInPlace: (name: string, script: string) =>
    `${shown(script)} changed since ${shown(name)} completion install wrote it, so it was left in place.`,
  noLongerHolds: (name: string, startup: string) =>
    `${shown(startup)} no longer holds the line ${shown(name)} completion install added, so it was left as it is.`,
  noneToRemove: (name: string) =>
    `${shown(name)} has no completion installed, so there is nothing to remove.`,
  noneToUpdate: (name: string) =>
    `${shown(name)} has no completion installed, so there is nothing to update. Run ${shown(name)} completion install to install it.`,
  notInstalled: (name: string, script: string) =>
    `${shown(script)} was not installed by ${shown(name)} completion install.`,
  openShell: 'Open a new shell to use it.',
  policy: (name: string, policy: string, startup: string) =>
    `PowerShell's execution policy is ${shown(policy)}, so it runs no unsigned profile or script, and ${shown(name)} did not add its startup line. To use completion, allow local scripts, such as with Set-ExecutionPolicy -Scope CurrentUser RemoteSigned where no Group Policy sets the policy, then add this line to ${shown(startup)}:`,
  removeYourself: (name: string, startup: string) =>
    `${shown(name)} cannot change ${shown(startup)}, so remove this line from it yourself:`,
  removed: (path: string) => `Removed ${shown(path)}.`,
  removedLine: (startup: string) => `Removed the line from ${shown(startup)}.`,
  unchanged: (script: string) => `${shown(script)} is unchanged.`,
  updated: (shell: string, script: string) =>
    `Updated the ${shell} completion script in ${shown(script)}.`,
  updatedLine: (startup: string) => `Updated the line in ${shown(startup)}.`,
};

export { lines, refusals };
