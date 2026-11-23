import type { EnvironmentOf, PathsOf } from '@loomcli/core';
import { Application, Command, plugin } from '@loomcli/core';
import { z } from 'zod';

import { getValue } from './get-value.js';
import { summary } from './summary.js';

// The registered Application installs this plugin.
// So every Application these Commands attach to installs it too: its options are global options the Commands' actions read typed.
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
  .passthrough()
  .action(getValue);

const keys = new Command('keys').passthrough().action(({ args, options, passthrough }) => {
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

// A Command the registered Application attaches calls `invoke` over the paths that Application
// Registers, which include this Command's own, so the registration is read with no circular type.
const echo = new Command('echo').action(async ({ invoke }) => {
  const read = await invoke(['get'], { args: { path: 'user' }, options: { raw: true } });
  // @ts-expect-error TS2353: An option the routed Command and the globals do not declare is rejected.
  await invoke(['get'], { options: { rw: true } });
  const again = await invoke(['echo'], {});
  return [read, again];
});

const jsonkit = new Application('jsonkit', { plugins: [vocabulary()] })
  .globalOption('file', { default: 'jsonkit.json', short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: z.string().transform(Number) })
  .option('pretty', { short: 'p', type: 'boolean' })
  .command(get)
  .command(keys)
  .command(echo)
  .action(summary);

const configured = new Application('registered', { plugins: [vocabulary()] })
  .globalOption('file', { default: 'registered.json', short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: z.string().transform(Number) });
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
    // The completed Application's Command paths, which every action's `invoke` reads.
    paths: PathsOf<typeof jsonkit>;
  }
}

export { configured, echo, get, keys, jsonkit, vocabulary };
