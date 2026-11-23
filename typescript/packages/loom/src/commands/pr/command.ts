import { Command } from '@loomcli/core';

/*
 * The action imports its work when it runs, so a run of any other command, help included, loads
 * none of it.
 */

export const prCheck = new Command('check', {
  description: 'Check a pull request against its base for changelog and release rules.',
})
  .option('base', {
    description: 'Name the base revision the pull request targets.',
    required: true,
    type: 'string',
  })
  .option('head', {
    default: 'HEAD',
    description: 'Name the head revision of the pull request.',
    type: 'string',
  })
  .option('title', {
    description: 'Give the pull request title.',
    required: true,
    type: 'string',
  })
  .option('label', {
    description: 'Name a label on the pull request. Repeat for more.',
    multiple: true,
    type: 'string',
  })
  .action(async (context) => {
    const { checkPr } = await import('./check.js');
    await checkPr(context);
  });

export const pr = new Command('pr', { description: 'Check a pull request.', hidden: true }).command(
  prCheck,
);
