import { Command } from '@loomcli/core';
import { z } from 'zod';

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
  );
