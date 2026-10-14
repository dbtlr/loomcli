/**
 * The folders the installing plugins read from the host's environment, and the refusals of an
 * environment that cannot name one: the operator's home folder and the installation record's
 * directory. The skills, completion, and manpage plugins share them, so each says the same thing.
 */
import { isAbsolute } from 'node:path';

import { applicationDirectory, escapeControlCharacters, FatalError } from '@loomcli/core';
import type { Host } from '@loomcli/core';

/** The name of the variable that holds the home folder on a platform. */
function homeVariable(platform: string): 'HOME' | 'USERPROFILE' {
  return platform === 'win32' ? 'USERPROFILE' : 'HOME';
}

/** The refusal of a folder variable that does not hold an absolute path, which exits 1. */
function homeRefusal(name: string, variable: string): FatalError {
  return new FatalError(
    `${escapeControlCharacters(name)} cannot find your home folder because ${variable} is not an absolute path. Set ${variable} to an absolute path, then run the command again.`,
  );
}

/** The absolute path a variable of the host's environment holds, or none. */
function absoluteVariable(host: Host, variable: string): string | undefined {
  const value = host.env[variable];
  return value !== undefined && isAbsolute(value) ? value : undefined;
}

/** The absolute home folder the host's environment names, or none. */
function homeOf(host: Host): string | undefined {
  return absoluteVariable(host, homeVariable(host.platform));
}

/** The home folder the host's environment names, or the refusal of one that is not absolute. */
function requiredHome(name: string, host: Host): string {
  const home = homeOf(host);
  if (home === undefined) {
    throw homeRefusal(name, homeVariable(host.platform));
  }
  return home;
}

/** The installation record's directory, or the refusal of an environment that cannot name one. */
function recordDirectory(name: string, host: Host): string {
  const directory = applicationDirectory('installation', name, host);
  if ('variable' in directory) {
    throw new FatalError(
      `${escapeControlCharacters(name)} cannot find its installation record because ${directory.variable} is not an absolute path. Set ${directory.variable} to an absolute path, then run the command again.`,
    );
  }
  return directory.path;
}

export { absoluteVariable, homeOf, homeRefusal, homeVariable, recordDirectory, requiredHome };
