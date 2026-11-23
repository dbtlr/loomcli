import { Command } from '@loomcli/core';

import { loomConfig } from '../../helpers/loom-config.js';

export const docs = new Command('docs', {
  description: 'Write a Markdown command reference for the whole application into a directory.',
  uses: [loomConfig],
})
  .argument('directory', {
    description: 'Write the reference files in this directory, created when it does not exist.',
    required: true,
    type: 'string',
  })
  .option('application', {
    description:
      'Read this Application module instead of paths.application, by default src/application.ts.',
    type: 'string',
  })
  .action(async (context) => {
    const { writeDocs } = await import('./write.js');
    await writeDocs(context);
  });
