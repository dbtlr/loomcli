import { Command } from '@loomcli/core';

import { checkPullRequest } from '../../helpers/pr-check.js';

export const pr = new Command('pr', { description: 'Check a pull request.', hidden: true }).command(
  new Command('check', {
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
    .action(async ({ host, options, out, passthrough }) => {
      try {
        if (passthrough.length > 0) {
          out.fatal('Arguments after -- are not supported.');
        }
        checkPullRequest(host.cwd, {
          base: options.base,
          head: options.head,
          labels: options.label,
          title: options.title,
        });
        await out.render('PR checks passed.\n', { render: (value) => value });
      } catch (error) {
        out.fatal(error instanceof Error ? error.message : String(error));
      }
    }),
);
