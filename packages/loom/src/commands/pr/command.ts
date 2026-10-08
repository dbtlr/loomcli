import { Command } from '@loomcli/core';

import { checkPullRequest } from '../../helpers/pr-check.js';
import { report } from '../../helpers/report.js';

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
      await report(out, passthrough, () => {
        checkPullRequest(host.cwd, {
          base: options.base,
          head: options.head,
          labels: options.label,
          title: options.title,
        });
        return 'PR checks passed.\n';
      });
    }),
);
