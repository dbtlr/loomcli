import { Command } from '@loomcli/core';
import { z } from 'zod';

import { publishPublication } from '../../helpers/publication-release.js';
import { publicationServices } from '../../helpers/publication-services.js';
import { preparePublication, verifyPublication } from '../../helpers/publication.js';

export const publication = new Command('publication')
  .command(
    new Command('prepare')
      .option('base', { required: true, type: 'string' })
      .option('head', { required: true, type: 'string' })
      .option('title', { required: true, type: 'string' })
      .option('output', { required: true, type: 'string' })
      .option('runtime', { default: 'node', type: 'string', validate: z.enum(['node', 'bun']) })
      .action(async ({ host, options, out, passthrough }) => {
        try {
          if (passthrough.length > 0) {
            out.fatal('Arguments after -- are not supported.');
          }
          const result = preparePublication(host.cwd, options);
          await out.render(`${JSON.stringify(result)}\n`, { render: (value) => value });
        } catch (error) {
          out.fatal(error instanceof Error ? error.message : String(error));
        }
      }),
  )
  .command(
    new Command('verify')
      .option('artifacts', { required: true, type: 'string' })
      .option('digest', { required: true, type: 'string' })
      .option('head', { required: true, type: 'string' })
      .option('runtime', { default: 'node', type: 'string', validate: z.enum(['node', 'bun']) })
      .action(async ({ host, options, out, passthrough }) => {
        try {
          if (passthrough.length > 0) {
            out.fatal('Arguments after -- are not supported.');
          }
          const result = verifyPublication(host.cwd, options);
          await out.render(`${JSON.stringify(result)}\n`, { render: (value) => value });
        } catch (error) {
          out.fatal(error instanceof Error ? error.message : String(error));
        }
      }),
  )
  .command(
    new Command('publish')
      .option('artifacts', { required: true, type: 'string' })
      .option('digest', { required: true, type: 'string' })
      .option('head', { required: true, type: 'string' })
      .option('repository', { required: true, type: 'string' })
      .option('run', { required: true, type: 'string' })
      .option('artifact', { required: true, type: 'string' })
      .option('auth', {
        required: true,
        type: 'string',
        validate: z.enum(['bootstrap', 'trusted']),
      })
      .action(async ({ host, options, out, passthrough }) => {
        try {
          if (passthrough.length > 0) {
            out.fatal('Arguments after -- are not supported.');
          }
          if (
            process.env.GITHUB_ACTIONS !== 'true' ||
            process.env.GITHUB_SHA !== options.head ||
            process.env.GITHUB_REPOSITORY !== options.repository
          ) {
            out.fatal(
              'Publication requires a GitHub Actions run at the retained source in the selected repository.',
            );
          }
          const result = await publishPublication(
            host.cwd,
            options,
            publicationServices(options.repository, options.auth),
          );
          await out.render(`${JSON.stringify(result)}\n`, { render: (value) => value });
        } catch (error) {
          out.fatal(error instanceof Error ? error.message : String(error));
        }
      }),
  );
