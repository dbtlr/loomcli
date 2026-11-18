import { Command } from '@loomcli/core';

import { loomConfig } from '../../helpers/loom-config.js';

export const exportSkills = new Command('export', {
  description: "Write the application's skills and command references into a repository.",
  uses: [loomConfig],
})
  .argument('directory', {
    description: 'The output directory, resolved from the working directory.',
    required: true,
    type: 'string',
  })
  .option('skill', {
    description: 'Export this declared skill, repeatable; by default export every skill.',
    multiple: true,
    type: 'string',
  })
  .option('application', {
    description:
      'Read this Application module instead of paths.application, by default src/application.ts.',
    type: 'string',
  })
  .action(async (context) => {
    const { exportApplicationSkills } = await import('./export.js');
    await exportApplicationSkills(context);
  });

export const skillsCommand = new Command('skills', {
  description: 'Keep a committed copy of application skills.',
}).command(exportSkills);
