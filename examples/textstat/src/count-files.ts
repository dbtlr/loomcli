import { FatalError } from '@loomcli/core';
import type { ActionHandler, ActionOptions, Content, Log } from '@loomcli/core';

import type { textstat } from './application.js';
import { countSource } from './count-source.js';
import { totalRow } from './row.js';
import type { Row } from './row.js';

/**
 * The reason a read failed, as one sentence ending in a period. A reason that already ends with one
 * keeps it, so the fix that follows never reads after two periods.
 */
function explain(error: unknown): string {
  const reason = error instanceof Error ? error.message : 'The source could not be read.';
  return reason.endsWith('.') ? reason : `${reason}.`;
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
  selected: readonly Content[],
  log: Log,
): Promise<Counted> {
  const rows: Row[] = [];
  const minimum = options['min-bytes'];
  let total = 0;
  for (const source of selected) {
    const counts = await countSource(source.stream(), options.metric).catch((error: unknown) => {
      throw new FatalError(
        `Cannot read ${source.kind === 'stdin' ? 'stdin' : `file: ${source.name}`}: ${explain(error)} Supply readable files, or pipe text to stdin.`,
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
export const countFiles: ActionHandler<typeof textstat> = async ({ args, log, options, out }) => {
  const started = performance.now();
  const counted = await countAll(options, args.files, log);
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
