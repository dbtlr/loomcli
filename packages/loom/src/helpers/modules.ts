import { existsSync } from 'node:fs';
import { relative } from 'node:path';

/** A path as the operator reads it: relative to the working directory. */
export function shown(cwd: string, path: string) {
  return relative(cwd, path) || '.';
}

/**
 * The module at an absolute path, which an option, a configuration key, or a convention places. A
 * module that does not exist fails the command, naming it and `naming`, the option or the key that
 * names another, such as `--application` or `paths.application`.
 */
export function existingModule(cwd: string, path: string, naming: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `${shown(cwd, path)} does not exist, so create it or name the module with ${naming}.`,
    );
  }
  return path;
}
