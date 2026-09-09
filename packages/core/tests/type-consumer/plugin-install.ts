import { Application, Command, GlobalOptions, readExtension } from '@loomcli/core';
import type { ArgumentNode, CommandNode, OptionNode } from '@loomcli/core';

import { help } from './plugin-entry.js';
import { helpArgument, helpCommand, helpInput } from './plugin-extension.js';
import { timer } from './plugin-timer.js';

// Extension values sit on a global option, a Command, a local option, and an argument alike, and
// The plugin option in `plugin-entry.ts` carries one too.
const globals = new GlobalOptions().option('file', {
  extensions: [helpInput({ placeholder: 'path' })],
  short: 'f',
  type: 'string',
});

const get = new Command('get', {
  description: 'Read one value at a path.',
  extensions: [helpCommand({ examples: [{ command: 'get user.name', note: 'a nested key' }] })],
  globals,
})
  .argument('path', { extensions: [helpArgument({ hint: 'a dot path' })], required: true })
  .option('raw', { extensions: [helpInput({ placeholder: 'raw' })], type: 'boolean' })
  .action(({ args }) => args.path);

const app = new Application('consumer', {
  extensions: [helpCommand({ details: 'The whole application.' })],
  globals,
  plugins: [help(), timer()],
  version: '1.0.0',
})
  .command(get)
  .action(() => undefined);

// A typed read takes the node kind its descriptor targets, and answers the schema's output.
const graph = app.inspect();
const root: CommandNode = graph.root;
const option: OptionNode | undefined = graph.globals[0];
const child: CommandNode | undefined = root.children[0];
const argument: ArgumentNode | undefined = child?.arguments[0];

const summary: string | undefined = readExtension(root, helpCommand)?.details;
const placeholder: string | undefined = option
  ? readExtension(option, helpInput)?.placeholder
  : undefined;
const hint: string | undefined = argument ? readExtension(argument, helpArgument)?.hint : undefined;

// The output reads deeply read-only, so a consumer walks it without copying it.
const examples = readExtension(root, helpCommand)?.examples;
const commands: readonly string[] = examples?.map((entry) => entry.command) ?? [];

export { app, commands, hint, placeholder, summary };
