import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';

import type { ActionHandler, ActionOptions, Host, Out } from '@loomcli/core';

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

/** An omitted deprecated threshold drops nothing, so it never raises the effective minimum. */
const NO_MINIMUM = 0;

/**
 * The byte threshold one invocation applies. Two spellings name it while the deprecated one lives,
 * so the larger of the two rules and neither spelling loosens the other.
 */
function threshold(options: ActionOptions<typeof textstat>): number {
  return Math.max(options['min-bytes'], options.minimum ?? NO_MINIMUM);
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
  out: Out,
): Promise<Counted> {
  const rows: Row[] = [];
  const minimum = threshold(options);
  let total = 0;
  for (const source of selected) {
    const counts = await countSource(source.open(), options.metric).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'The source could not be read.';
      return out.fatal(`Cannot read ${source.failure}: ${reason}`);
    });
    if (counts.bytes >= minimum) {
      total += counts.counted;
      rows.push({ count: counts.counted, source: source.name });
    }
  }
  return { rows, total };
}

/** The whole table is rendered at once, and the hidden timing line follows it on stderr. */
export const countFiles: ActionHandler<typeof textstat> = async ({ args, options, host, out }) => {
  const started = performance.now();
  const counted = await countAll(options, sources(args.files, host), out);
  await out.render(
    {
      metric: options.metric,
      rows: counted.rows,
      total: options.total ? counted.total : undefined,
    },
    tableRenderer,
  );
  if (options.timing) {
    await out.info(`elapsed: ${Math.round(performance.now() - started)}ms`);
  }
};
