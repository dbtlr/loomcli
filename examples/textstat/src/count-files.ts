import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';

import { FatalError } from '@loomcli/core';
import type { ActionHandler, ActionOptions, Host, Log } from '@loomcli/core';

import type { textstat } from './application.js';
import { countSource } from './count-source.js';
import { checkFilesOrStdin } from './files-or-stdin.js';
import { totalRow } from './row.js';
import type { Row } from './row.js';

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
 * The reason a read failed, as one sentence ending in a period. A reason that already ends with one
 * keeps it, so the fix that follows never reads after two periods.
 */
function explain(error: unknown): string {
  const reason = error instanceof Error ? error.message : 'The source could not be read.';
  return reason.endsWith('.') ? reason : `${reason}.`;
}

/**
 * The sources of one invocation. Supplied files are the whole selection, so no first file is the
 * whole rule for reading stdin, once an empty selection at a terminal has been rejected.
 */
function sources(files: readonly string[], host: Host): Source[] {
  checkFilesOrStdin(files, host);
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

/** What one pass over the sources produced: the rows it kept and the total of their counts. */
interface Counted {
  rows: Row[];
  total: number;
}

/**
 * Rows are collected while the sources are counted and returned once at the end, so a read failure
 * on any source ends the invocation before a partial table reaches stdout.
 */
async function countAll(
  options: ActionOptions<typeof textstat>,
  selected: readonly Source[],
  log: Log,
): Promise<Counted> {
  const rows: Row[] = [];
  const minimum = options['min-bytes'];
  let total = 0;
  for (const source of selected) {
    const counts = await countSource(source.open(), options.metric).catch((error: unknown) => {
      throw new FatalError(
        `Cannot read ${source.failure}: ${explain(error)} Supply readable files, or pipe text to stdin.`,
      );
    });
    if (counts.bytes >= minimum) {
      total += counts.counted;
      rows.push({ count: counts.counted, source: source.name });
    } else {
      log.debug('Dropped a source below the byte threshold.', {
        bytes: counts.bytes,
        minimum,
        source: source.name,
      });
    }
  }
  return { rows, total };
}

/** The counted rows are emitted at once as the result, and the hidden timing line follows it. */
export const countFiles: ActionHandler<typeof textstat> = async ({
  args,
  host,
  log,
  options,
  out,
}) => {
  const started = performance.now();
  const counted = await countAll(options, sources(args.files, host), log);
  log.info('Counted the sources.', {
    kept: counted.rows.length,
    metric: options.metric,
    sources: args.files.length,
  });
  const rows: Row[] = options.total
    ? [...counted.rows, { count: counted.total, source: 'total', [totalRow]: true }]
    : counted.rows;
  await out.results(rows);
  if (options.timing) {
    await out.info(`elapsed: ${Math.round(performance.now() - started)}ms`);
  }
};
