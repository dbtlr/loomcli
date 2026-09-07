import type { Renderer } from '@loom/core';

import type { Metric } from './count-source.js';

/** Two spaces separate the count column from the source column. */
const GUTTER = '  ';

/** One counted source: the number its metric produced, and the name the row prints. */
export interface Row {
  count: number;
  source: string;
}

/** One invocation's counts: the metric that produced them, and the total when it was asked for. */
export interface Table {
  metric: Metric;
  rows: readonly Row[];
  total: number | undefined;
}

/**
 * The whole table as text, so the application owns every byte core writes. The header names the
 * metric, the counts right-align under it in a column as wide as the header or the widest count,
 * and the total, when the invocation asked for one, is the last row. The header prints even for an
 * empty selection, so a filtered run still reports the metric it counted.
 */
export const table: Renderer<Table> = {
  render: ({ metric, rows, total }) => {
    const heading = metric.toUpperCase();
    const printed = total === undefined ? rows : [...rows, { count: total, source: 'total' }];
    const cells = printed.map((row) => ({ count: String(row.count), source: row.source }));
    const width = Math.max(heading.length, ...cells.map((cell) => cell.count.length));
    const lines = [
      `${heading.padStart(width)}${GUTTER}SOURCE`,
      ...cells.map((cell) => `${cell.count.padStart(width)}${GUTTER}${cell.source}`),
    ];
    return `${lines.join('\n')}\n`;
  },
};
