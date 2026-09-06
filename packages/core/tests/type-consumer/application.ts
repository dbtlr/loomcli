import { Application } from '@loom/core';

import { countFiles } from './count-files.js';

export const textstat = new Application('textstat')
  .argument('files', { required: true, variadic: true })
  .action(countFiles);
