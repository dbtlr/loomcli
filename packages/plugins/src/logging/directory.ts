import { isAbsolute, join } from 'node:path';

import { applicationDirectory } from '@loomcli/core';
import type { LogDestination } from '@loomcli/core';

import { LoggingError } from './error.js';

/** The failure of a path the variable `name` cannot give. */
function unresolved(name: string): LoggingError {
  return new LoggingError('unresolved-directory', { path: null, variable: name });
}

/** The directory a platform keeps an application's logs in, as core's `logs` lookup resolves it. */
function defaultDirectory(application: string, destination: LogDestination): string | LoggingError {
  const lookup = applicationDirectory('logs', application, destination);
  return 'path' in lookup ? lookup.path : unresolved(lookup.variable);
}

/**
 * The home directory a `~/` path starts from: the destination's `home`, the outermost run's
 * `host.home`, when it is absolute, on every platform.
 */
function homeDirectory(destination: LogDestination): string | LoggingError {
  return isAbsolute(destination.home) ? destination.home : unresolved('HOME');
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
