import type { ActionHandler, Renderer } from '@loom/core';

import type { textstat } from './application.js';

interface Row {
  count: number;
  source: string;
}

interface Table {
  metric: string | undefined;
  rows: readonly Row[];
  total: number | undefined;
}

/** The example renders its whole table through one application-owned renderer. */
const tableRenderer: Renderer<Table> = {
  render: ({ metric, rows, total }) =>
    [
      metric ?? 'bytes',
      ...rows.map((row) => `${String(row.count)}  ${row.source}`),
      ...(total === undefined ? [] : [`${String(total)}  total`]),
    ].join('\n'),
};

export const countFiles: ActionHandler<typeof textstat> = async ({
  args,
  options,
  passthrough,
  out,
}) => {
  const files: string[] = args.files;
  const metric: string | undefined = options.metric;
  const total: boolean = options.total;
  const tail: string[] = passthrough;
  const rows: Row[] = files.map((source) => ({ count: source.length, source }));
  await out.render({ metric, rows, total: total ? rows.length : undefined }, tableRenderer);
  return { files, metric, tail, total };
};
