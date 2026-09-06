import type { ActionHandler } from '@loom/core';

import type { textstat } from './application.js';

export const countFiles: ActionHandler<typeof textstat> = ({ args }) => {
  const files: string[] = args.files;
  return files.length;
};
