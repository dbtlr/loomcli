import { accessSync, constants } from 'node:fs';

/** The first directory the process cannot write to, with the runtime's error, or none. */
function unwritable(
  directories: readonly string[],
): { directory: string; cause: unknown } | undefined {
  for (const directory of directories) {
    try {
      accessSync(directory, constants.W_OK);
    } catch (error) {
      return { cause: error, directory };
    }
  }
  return undefined;
}

export { unwritable };
