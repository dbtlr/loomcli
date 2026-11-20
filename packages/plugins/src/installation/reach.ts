/*
 * The failures of a path the installed-files module cannot reach, each worded from the system
 * error's code, so the operator reads the path and a step in place of the runtime's error.
 */
import { FatalError } from '@loomcli/core';

import { installationPhrase } from './phrases.js';

/** The runtime error's code, such as `ENOENT`, or `undefined` for a value that carries none. */
function errorCode(error: unknown): unknown {
  return error instanceof Error ? Reflect.get(error, 'code') : undefined;
}

/** The failure that says a file sits where a folder of `path` is needed. */
function blocked(path: string): FatalError {
  return new FatalError(installationPhrase('pathBlocked', path));
}

/**
 * Runs a read or a removal at `path` and turns the system error that says a file sits where one of
 * its folders is needed into a failure that names the path and a step, so the module never reads a
 * path below a file as gone. Any other error passes through.
 */
function reading<Result>(path: string, read: () => Result): Result {
  try {
    return read();
  } catch (error) {
    if (errorCode(error) === 'ENOTDIR') {
      throw blocked(path);
    }
    throw error;
  }
}

/**
 * Runs a write at `path` and turns a system error that says a file sits where a folder is needed,
 * or that the location cannot be written, into a failure that names the path and a step. Any other
 * error passes through.
 */
function writing<Result>(path: string, write: () => Result): Result {
  try {
    return write();
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOTDIR' || code === 'EEXIST') {
      throw blocked(path);
    }
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new FatalError(installationPhrase('writeUnwritable', path, code === 'EROFS'));
    }
    throw error;
  }
}

export { errorCode, reading, writing };
