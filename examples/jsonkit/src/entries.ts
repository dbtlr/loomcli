import type { RowView, View } from '@loomcli/core';

/** Two spaces separate the path column from the kind column in the buffered presentation. */
const GUTTER = '  ';

const HEADING = 'PATH';

/** One reachable place in the document: the dot path that resolves it, and what it holds. */
export interface Entry {
  kind: string;
  path: string;
}

/**
 * The default presentation, one tab-separated line per path as the walk yields it. The row view
 * renders before the source ends, so a large document starts printing at once, and every function
 * owns the newline in the text it returns.
 */
export const pathList: RowView<Entry> = {
  head: () => `${HEADING}\tKIND\n`,
  row: ({ kind, path }, index, { style }) => `${style.escape(path)}\t${kind}\n`,
};

/**
 * The second presentation, which reads the whole walk before it renders: the path column is as
 * wide as the widest path, so an operator reading a finite document scans one aligned column.
 */
export const pathTable: View<readonly Entry[]> = {
  render: (entries, { style }) => {
    const cells = entries.map(({ kind, path }) => ({ kind, path: style.escape(path) }));
    const width = Math.max(HEADING.length, ...cells.map((cell) => cell.path.length));
    const lines = [
      `${HEADING.padEnd(width)}${GUTTER}KIND`,
      ...cells.map((cell) => `${cell.path.padEnd(width)}${GUTTER}${cell.kind}`),
    ];
    return `${lines.join('\n')}\n`;
  },
};
