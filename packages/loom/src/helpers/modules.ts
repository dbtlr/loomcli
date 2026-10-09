import { existsSync } from 'node:fs';
import { relative } from 'node:path';

/** A path as the operator reads it: relative to the working directory. */
export function shown(cwd: string, path: string) {
  return relative(cwd, path) || '.';
}

/**
 * The module at an absolute path, which an option names or a convention places. A module that does
 * not exist fails the command, naming it and the option that names another.
 */
export function existingModule(cwd: string, path: string, option: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `${shown(cwd, path)} does not exist, so create it or name the module with --${option}.`,
    );
  }
  return path;
}
