import type { EnvironmentOf } from '@loomcli/core';
import { Application, Command, plugin } from '@loomcli/core';
import { z } from 'zod';

import { getValue } from './get-value.js';
import { summary } from './summary.js';

const get = new Command('get')
  .argument('path', { required: true })
  .option('raw', { short: 'r', type: 'boolean' })
  .action(getValue);

const keys = new Command('keys').action(({ args, options, passthrough }) => {
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

const jsonkit = new Application('jsonkit')
  .globalOption('file', { required: true, short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: z.string().transform(Number) })
  .option('pretty', { short: 'p', type: 'boolean' })
  .command(get)
  .command(keys)
  .action(summary);

const configured = new Application('registered', {
  plugins: [plugin('registered/vocabulary', { options: { identifier: { type: 'boolean' } } })],
})
  .globalOption('file', { required: true, short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: z.string().transform(Number) });
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export { configured, get, keys, jsonkit };
