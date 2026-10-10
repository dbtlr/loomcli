import { isAbsolute, join } from 'node:path';

import type { LogDestination } from '@loomcli/core';

import { LoggingError } from './error.js';

/** A variable's value, or `undefined` when the run left it unset or empty. */
function variableOf(destination: LogDestination, name: string): string | undefined {
  const value = destination.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** A variable the path needs, or the failure that names it. */
function required(destination: LogDestination, name: string): string | LoggingError {
  return (
    variableOf(destination, name) ??
    new LoggingError('unresolved-directory', { path: null, variable: name })
  );
}

/**
 * The directory a platform keeps an application's logs in, read from the destination's `env` and
 * `platform` alone: the Library/Logs folder on `darwin`, the Logs folder under `LOCALAPPDATA` on
 * `win32`, and the state directory elsewhere, `XDG_STATE_HOME` when it is absolute.
 */
function defaultDirectory(application: string, destination: LogDestination): string | LoggingError {
  switch (destination.platform) {
    case 'darwin': {
      const home = required(destination, 'HOME');
      return home instanceof LoggingError ? home : join(home, 'Library', 'Logs', application);
    }
    case 'win32': {
      const local = required(destination, 'LOCALAPPDATA');
      return local instanceof LoggingError ? local : join(local, application, 'Logs');
    }
    default: {
      const state = variableOf(destination, 'XDG_STATE_HOME');
      if (state !== undefined && isAbsolute(state)) {
        return join(state, application);
      }
      const home = required(destination, 'HOME');
      return home instanceof LoggingError ? home : join(home, '.local', 'state', application);
    }
  }
}

/** The home directory a `~/` path starts from: `HOME`, or `USERPROFILE` on `win32` without it. */
function homeDirectory(destination: LogDestination): string | LoggingError {
  if (destination.platform === 'win32' && variableOf(destination, 'HOME') === undefined) {
    return required(destination, 'USERPROFILE');
  }
  return required(destination, 'HOME');
}

const homePrefix = '~/';

/**
 * The log file: `<application>.jsonl` in the default directory without a `file` setting; a `file`
 * that starts with `~/` under the home directory, an absolute one as written, and any other inside
 * the default directory. Nothing resolves against the working directory. A path the destination's
 * variables cannot give is the failure that names the missing variable.
 */
function resolveLogFile(
  file: string | undefined,
  application: string,
  destination: LogDestination,
): string | LoggingError {
  if (file?.startsWith(homePrefix)) {
    const home = homeDirectory(destination);
    return home instanceof LoggingError ? home : join(home, file.slice(homePrefix.length));
  }
  if (file !== undefined && isAbsolute(file)) {
    return file;
  }
  const directory = defaultDirectory(application, destination);
  return directory instanceof LoggingError
    ? directory
    : join(directory, file ?? `${application}.jsonl`);
}

export { resolveLogFile };
