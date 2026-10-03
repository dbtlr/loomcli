import type { EnvironmentOf } from '@loomcli/core';
import { Application, Command, plugin } from '@loomcli/core';
import { z } from 'zod';

import { getValue } from './get-value.js';
import { summary } from './summary.js';

// The registered Application installs this plugin, so every Application these Commands attach to
// Installs it too: its options are global options the Commands' actions read typed.
const vocabulary = () =>
  plugin('registered/vocabulary', {
    options: {
      identifier: { type: 'boolean' },
      level: {
        env: 'REGISTERED_LEVEL',
        type: 'string',
        validate: z.enum(['debug', 'info']).transform((value) => value.toUpperCase()),
      },
    },
  });

const get = new Command('get')
  .argument('path', { required: true })
  .option('raw', { short: 'r', type: 'boolean' })
  .action(getValue);

const keys = new Command('keys').action(({ args, options, passthrough }) => {
  const file: string = options.file;
  const quiet: boolean = options.quiet;
  const limit: number | undefined = options.limit;
  const tail: string[] = passthrough;
  // A plugin's options reach a registered Command typed, a validated one as its validator's output.
  const identifier: boolean = options.identifier;
  const level: string | undefined = options.level;
  // @ts-expect-error TS2322: A plugin's validated option reads its validator's output, never a number.
  const wrong: number = options.level;
  // @ts-expect-error TS2339: A sibling Command's local options stay out of this handler.
  options.raw;
  // @ts-expect-error TS2339: A Command without arguments has no argument keys.
  args.path;
  return { file, identifier, level, limit, quiet, tail, wrong };
});

// @ts-expect-error TS2345: A registered Command's local option cannot take the name of a plugin's option.
new Command('shadow').option('level', { type: 'string' });

const jsonkit = new Application('jsonkit', { plugins: [vocabulary()] })
  .globalOption('file', { default: 'jsonkit.json', short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: z.string().transform(Number) })
  .option('pretty', { short: 'p', type: 'boolean' })
  .command(get)
  .command(keys)
  .action(summary);

const configured = new Application('registered', { plugins: [vocabulary()] })
  .globalOption('file', { default: 'registered.json', short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: z.string().transform(Number) });
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export { configured, get, keys, jsonkit, vocabulary };
