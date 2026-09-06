import type { ActionHandler } from '@loom/core';

import type { textstat } from './application.js';

export const countFiles: ActionHandler<typeof textstat> = ({ args, options, passthrough }) => {
  const files: string[] = args.files;
  const metric: string | undefined = options.metric;
  const total: boolean = options.total;
  const tail: string[] = passthrough;
  return { files, metric, tail, total };
};
