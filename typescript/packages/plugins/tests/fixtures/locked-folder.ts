/*
 * A folder a test locks by its mode, and the restore that finds it again wherever a run moved it,
 * so a test that fails after a run claimed the folder under a retired name still leaves nothing in
 * its sandbox that the cleanup cannot remove.
 */
import { chmodSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Sets the mode of `folder` to `mode` everywhere below `directory` that the folder can be found. */
function restoreBelow(directory: string, folder: { ino: number; mode: number }): void {
  if (lstatSync(directory).ino === folder.ino) {
    chmodSync(directory, folder.mode);
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      restoreBelow(join(directory, entry.name), folder);
    }
  }
}

/**
 * Sets the folder at `path` to `mode` and answers the restore of the mode it had, which looks for
 * the folder by its inode anywhere below `root`, the test's sandbox.
 */
export function lockFolder(root: string, path: string, mode: number): () => void {
  const { ino, mode: had } = lstatSync(path);
  chmodSync(path, mode);
  return () => {
    restoreBelow(root, { ino, mode: had & 0o7777 });
  };
}
