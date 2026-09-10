import { Application, Command, GlobalOptions } from '@loomcli/core';
import type { ActionArgs, ActionHandler, ActionOptions, CommandOptions } from '@loomcli/core';
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

// A core fact is typed, so a value of the wrong type never reaches the build rule that rejects it.
const numbered = { description: 42 };
// @ts-expect-error TS2345: A description is one line of prose, never a number.
new Command('numbered', numbered);
const counted = { version: 1 };
// @ts-expect-error TS2345: A version is an opaque string, never a number.
new Application('counted', counted);

// The core facts are optional, and a Command declares its description with or without globals.
const described: CommandOptions = { description: 'Reads a value.' };
new Command('summarized', { description: 'Reads one value.', globals })
  .argument('path', { description: 'The path to read.', required: true })
  .option('raw', { description: 'Prints the value unquoted.', type: 'boolean' })
  .action(() => {});
new Command('standalone', { description: 'Answers alone.' }).action(() => {});

// The two listing facts belong to a named Command and to an option, in every scope that declares one.
new Command('fetch', { deprecated: 'Use get instead.', description: 'Reads one value.', globals })
  .option('raw', { deprecated: 'Use --plain instead.', hidden: true, type: 'string' })
  .option('plain', { hidden: true, type: 'boolean' })
  .action(() => {});
new Command('debug', { globals, hidden: true }).action(() => {});
new GlobalOptions().option('legacy', {
  deprecated: 'Use --file instead.',
  hidden: true,
  type: 'string',
});

// Neither fact belongs to the root, which is every page's entry point.
// @ts-expect-error TS2353: The Application options carry no hidden.
new Application('hidden-root', { hidden: true });
// @ts-expect-error TS2353: The Application options carry no deprecated message.
new Application('deprecated-root', { deprecated: 'Use the other application.' });

// Neither fact belongs to an argument, which cannot leave the grammar it sits in.
// @ts-expect-error TS2353: An argument config carries no hidden.
new Command('argument-hidden').argument('path', { hidden: true });
// @ts-expect-error TS2353: An argument config carries no deprecated message.
new Command('argument-deprecated').argument('path', { deprecated: 'Use --file instead.' });
new Application('facts', {
  description: 'Reads a JSON document.',
  globals: new GlobalOptions().option('file', {
    description: 'The document to read.',
    type: 'string',
  }),
  version: '1.2.0',
})
  .argument('files', { description: 'The documents to read.', required: true, variadic: true })
  .action(() => {});
void described;

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
