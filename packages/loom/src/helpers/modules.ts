import { existsSync } from 'node:fs';
import { relative } from 'node:path';

import { missingModule } from '../commands/build/messages.js';

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
    throw new Error(missingModule(shown(cwd, path), naming));
  }
  return path;
}
