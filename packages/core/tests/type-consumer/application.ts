import { Application } from '@loomcli/core';

import { countFiles } from './count-files.js';

export const textstat = new Application('textstat')
  .argument('files', { required: true, variadic: true })
  .option('metric', { short: 'm', type: 'string' })
  .option('total', { polarity: 'both', short: 't', type: 'boolean' })
  .action(countFiles);
