import { FatalError } from '@loomcli/core';

import { errorCode } from './disk.js';
import { installationPhrase } from './phrases.js';

/**
 * Runs a write at `path` and turns a system error that says a file sits where a folder is needed,
 * or that the location cannot be written, into a failure that names the path and a step. Any other
 * error passes through.
 */
function reachable<Result>(path: string, write: () => Result): Result {
  try {
    return write();
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOTDIR' || code === 'EEXIST') {
      throw new FatalError(installationPhrase('writeBlocked', path));
    }
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new FatalError(installationPhrase('writeUnwritable', path, code === 'EROFS'));
    }
    throw error;
  }
}

export { reachable };
