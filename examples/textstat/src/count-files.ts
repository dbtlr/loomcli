import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';

import type { ActionHandler, Host } from '@loomcli/core';

import type { textstat } from './application.js';
import { countSource } from './count-source.js';
import { tableRenderer } from './table.js';
import type { Row } from './table.js';

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

/**
 * Rows are collected while the sources are counted and rendered once at the end, so a read failure
 * on any source ends the invocation before a partial table reaches stdout.
 */
export const countFiles: ActionHandler<typeof textstat> = async ({ args, options, host, out }) => {
  const rows: Row[] = [];
  let total = 0;
  for (const source of sources(args.files, host)) {
    const counts = await countSource(source.open(), options.metric).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'The source could not be read.';
      return out.fatal(`Cannot read ${source.failure}: ${reason}`);
    });
    if (counts.bytes >= options['min-bytes']) {
      total += counts.counted;
      rows.push({ count: counts.counted, source: source.name });
    }
  }
  await out.render(
    { metric: options.metric, rows, total: options.total ? total : undefined },
    tableRenderer,
  );
};
