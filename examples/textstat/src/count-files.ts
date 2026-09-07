import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';

import type { ActionHandler, Host } from '@loom/core';

import type { textstat } from './application.js';
import { countSource } from './count-source.js';

/** No supplied file is the whole rule for reading stdin, so the empty selection names it. */
const EMPTY = 0;

/**
 * One counted source: the name its row prints, the label a read failure reads under, and the
 * connection, opened only when the source is reached.
 */
interface Source {
  label: string;
  name: string;
  open: () => Readable;
}

/**
 * The sources of one invocation. Supplied files are the whole selection, so stdin is read only
 * when no file is named. The schema has already ruled out an empty selection at a terminal.
 */
function sources(files: readonly string[], host: Host): Source[] {
  if (files.length === EMPTY) {
    return [{ label: 'stdin', name: 'stdin', open: () => host.stdin }];
  }
  return files.map((file) => ({
    label: `file: ${file}`,
    name: file,
    open: () => createReadStream(resolve(host.cwd, file)),
  }));
}

export const countFiles: ActionHandler<typeof textstat> = async ({ args, options, host, out }) => {
  let total = 0;
  for (const source of sources(args.files, host)) {
    const counts = await countSource(source.open(), options.metric).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'The source could not be read.';
      return out.fatal(`Cannot read ${source.label}: ${reason}`);
    });
    if (counts.bytes >= options['min-bytes']) {
      total += counts.metric;
      await out.print(`${counts.metric}\t${source.name}`);
    }
  }
  if (options.total) {
    await out.print(`${total}\ttotal`);
  }
};
