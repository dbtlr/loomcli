import { Application, Command, GlobalOptions } from '@loomcli/core';
import { z } from 'zod';

import { getValue } from './get-value.js';
import { summary } from './summary.js';

export const globals = new GlobalOptions()
  .option('file', { required: true, short: 'f', type: 'string' })
  .option('quiet', { short: 'q', type: 'boolean' })
  .option('limit', { type: 'string', validate: z.string().transform(Number) });

export const get = new Command('get', { globals })
  .argument('path', { required: true })
  .option('raw', { short: 'r', type: 'boolean' })
  .action(getValue);

export const keys = new Command('keys', { globals }).action(({ args, options, passthrough }) => {
  const file: string = options.file;
  const quiet: boolean = options.quiet;
  const limit: number | undefined = options.limit;
  const tail: string[] = passthrough;
  // @ts-expect-error TS2339: A sibling Command's local options stay out of this handler.
  options.raw;
  // @ts-expect-error TS2339: A Command without arguments has no argument keys.
  args.path;
  return { file, limit, quiet, tail };
});

export const jsonkit = new Application('jsonkit', { globals })
  .option('pretty', { short: 'p', type: 'boolean' })
  .command(get)
  .command(keys)
  .action(summary);
