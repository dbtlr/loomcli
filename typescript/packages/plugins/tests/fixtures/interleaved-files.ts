/*
 * The files of a folder write, handed over with another run's steps taken at one point of the
 * write, so a test forces one interleaving of two runs on disk without timing.
 */
import type { FolderFile } from '../../src/installation/folders.js';

/**
 * The files of one run's folder write, with the other run's steps, `step`, taken as the write
 * reaches file `at`, or after its last file and before the swap when `at` is the file count.
 */
export function interleaved(
  files: readonly FolderFile[],
  at: number,
  step: () => void,
): FolderFile[] {
  const hooked = [...files];
  Object.defineProperty(hooked, Symbol.iterator, {
    *value() {
      for (const [index, file] of files.entries()) {
        if (index === at) {
          step();
        }
        yield file;
      }
      if (at === files.length) {
        step();
      }
    },
  });
  return hooked;
}
