import { Application, Command, plugin } from '@loomcli/core';
import type { ActionOptions, Plugin, PluginOptions } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';
import { z } from 'zod';

// A plugin's options are global options: a validator, a default, and a binding all apply.
const logOptions = {
  depth: {
    default: '1',
    type: 'string',
    validate: z
      .string()
      .regex(/^[0-9]+$/u)
      .transform(Number),
  },
  level: { env: 'LOG_LEVEL', type: 'string', validate: z.enum(['debug', 'info', 'warn']) },
  verbose: { short: 'v', type: 'boolean' },
} satisfies PluginOptions;
type LogOptions = typeof logOptions;

function log(): Plugin<LogOptions> {
  return plugin('@fixture/log', { options: logOptions });
}

// The constructor's plugin tuple adds every plugin's option values to the globals.
const configured = new Application('globals', { plugins: [help(), version(), log()] }).globalOption(
  'file',
  { short: 'f', type: 'string' },
);

const app = configured.action(({ options }) => {
  const shown: boolean = options.help;
  const printed: boolean = options.version;
  const verbose: boolean = options.verbose;
  // A validated option reads as its validator's output.
  const depth: number = options.depth;
  const level: 'debug' | 'info' | 'warn' | undefined = options.level;
  const file: string | undefined = options.file;
  // @ts-expect-error TS2322: A plugin's validated option is never read as its raw string.
  const raw: string = options.depth;
  return { depth, file, level, printed, raw, shown, verbose };
});

type Received = ActionOptions<typeof app>;
const received: Received['level'] = 'info';

// @ts-expect-error TS2345: A root-local option cannot take the name of a plugin's option.
configured.option('verbose', { type: 'boolean' });

// A list widened to `Plugin[]` states no plugins, so it names no option.
const widened: readonly Plugin[] = [help()];
new Application('wide', { plugins: widened }).action(({ options }) => {
  // @ts-expect-error TS2339: A widened list names no plugin's option.
  void options.help;
});

// A plugin's Commands compile without the Application, so their types name no global option.
const listed = new Command('listed').action(({ options }) => {
  // @ts-expect-error TS2339: A Command built where no Application registers globals reads none.
  void options.help;
});
plugin('@fixture/listed', { commands: [listed] });

void received;
