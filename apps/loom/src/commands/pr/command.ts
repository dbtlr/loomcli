import { Command } from '@loom/core';

import { checkPullRequest } from './check.js';

export const pr = new Command('pr').command(
  new Command('check')
    .option('base', { required: true, type: 'string' })
    .option('head', { default: 'HEAD', type: 'string' })
    .option('title', { required: true, type: 'string' })
    .option('label', { multiple: true, type: 'string' })
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
