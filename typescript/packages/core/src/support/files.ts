import { readFileSync, statSync } from 'node:fs';

/** The largest file core reads, so a path it is handed cannot make it read without end. */
const fileLimit = 1_048_576;

/**
 * One UTF-8 file read synchronously, or `undefined` when the path is not a regular file, such as a
 * FIFO, a device, or a directory, or is larger than 1 MiB. A call that fails throws its error.
 */
function readSmallFile(path: string): string | undefined {
  const stats = statSync(path);
  return stats.isFile() && stats.size <= fileLimit ? readFileSync(path, 'utf8') : undefined;
}

export { readSmallFile };
