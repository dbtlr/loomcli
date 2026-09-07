import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';

import type { ActionHandler, Host } from '@loom/core';

import type { textstat } from './application.js';
import { countSource } from './count-source.js';

/**
 * One counted source: the subject each failure names, the name its row prints, and the
 * connection, opened only when the source is reached.
 */
interface Source {
  /** A read failure names where the text came from, so a file failure keeps its path. */
  failure: string;
  /** A printed row names the source itself. */
  name: string;
  open: () => Readable;
}

/**
 * The sources of one invocation. Supplied files are the whole selection, so no first file is the
 * whole rule for reading stdin. The schema has already ruled out an empty selection at a terminal.
 */
function sources(files: readonly string[], host: Host): Source[] {
  const [named] = files;
  if (named === undefined) {
    return [{ failure: 'stdin', name: 'stdin', open: () => host.stdin }];
  }
  return files.map((file) => ({
    failure: `file: ${file}`,
    name: file,
    open: () => createReadStream(resolve(host.cwd, file)),
  }));
}

export const countFiles: ActionHandler<typeof textstat> = async ({ args, options, host, out }) => {
  let total = 0;
  for (const source of sources(args.files, host)) {
    const counts = await countSource(source.open(), options.metric).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'The source could not be read.';
      return out.fatal(`Cannot read ${source.failure}: ${reason}`);
    });
    if (counts.bytes >= options['min-bytes']) {
      total += counts.counted;
      await out.print(`${counts.counted}\t${source.name}`);
    }
  }
  if (options.total) {
    await out.print(`${total}\ttotal`);
  }
};
