import { Application, Command, GlobalOptions } from '@loomcli/core';
import type { ActionArgs, ActionHandler, ActionOptions } from '@loomcli/core';
import { z } from 'zod';

import { get, globals, jsonkit } from './commands.js';

const named = (args: ActionArgs<typeof get>, options: ActionOptions<typeof get>) => {
  const path: string = args.path;
  const file: string = options.file;
  const raw: boolean = options.raw;
  return { file, path, raw };
};
const summary: ActionHandler<typeof jsonkit> = ({ options, out }) =>
  out.print(`${options.file}:${String(options.pretty)}`);
const rootOptions = (options: ActionOptions<typeof jsonkit>) => options.pretty;
void named;
void summary;
void rootOptions;

// @ts-expect-error TS2339: A Command publishes no children to reach, replace, or extend.
get.children;
// @ts-expect-error TS2339: A Command publishes no action list, and `get` registered its action.
get.actions;
// @ts-expect-error TS2339: A Command does not publish its build step.
get.build;
// @ts-expect-error TS2339: GlobalOptions publishes no declaration list.
globals.inputs;
// @ts-expect-error TS2339: An Application publishes no root Command.
jsonkit.root;

new Command('optional').argument('path', { required: false });

// @ts-expect-error TS2559: A Command takes an options object, never a positional globals value.
new Command('positional', globals);

// @ts-expect-error TS2345: A local option cannot repeat a global option key.
new Command('collision', { globals }).option('file', { type: 'boolean' });
// @ts-expect-error TS2345: The root Command cannot repeat a global option key either.
new Application('collision', { globals }).option('quiet', { type: 'boolean' });
// @ts-expect-error TS2322: A globals type argument cannot forge values the declaration lacks.
new Application<{ forged: number }>('forged', { globals: new GlobalOptions() });
// @ts-expect-error TS2345: A child must carry the same globals value as its Application.
new Application('mismatch', { globals }).command(new Command('get').action(() => {}));

new Application('plain')
  .argument('files', { required: true, variadic: true })
  .option('metric', { type: 'string' })
  .action(({ args, options }) => {
    const files: string[] = args.files;
    const metric: string | undefined = options.metric;
    // @ts-expect-error TS2339: An Application without globals gains no global keys.
    options.file;
    return { files, metric };
  });

new Command('scalar')
  .argument('first', { required: true })
  .argument('second', { required: true, variadic: false })
  .argument('rest', { required: true, variadic: true })
  .action(({ args }) => {
    const first: string = args.first;
    const second: string = args.second;
    const rest: string[] = args.rest;
    // @ts-expect-error TS2322: A scalar argument is one string, not a collection.
    const wrong: string[] = args.first;
    return { first, rest, second, wrong };
  });

new Command('validated')
  .argument('count', { required: true, validate: z.string().transform(Number) })
  .action(({ args }) => {
    const count: number = args.count;
    return count;
  });
