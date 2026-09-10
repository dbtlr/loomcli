import { Command, plugin, readExtension } from '@loomcli/core';
import type {
  AnyExtension,
  ExtensionValue,
  Middleware,
  Plugin,
  PluginOptions,
} from '@loomcli/core';
import { z } from 'zod';

import type { help } from './plugin-entry.js';
import { helpArgument, helpCommand, helpInput } from './plugin-extension.js';
import { app } from './plugin-install.js';

const declared = { help: { type: 'boolean' } } satisfies PluginOptions;
const load = () => import('./plugin-middleware.js');
const forged = { identity: '@fixture/help' };
const activation = { activate: ['hlep'], load } as const;
const commandSlot = { extensions: [helpInput({ placeholder: 'topic' })] };
const optionSlot = { extensions: [helpCommand({})], type: 'boolean' } as const;
const argumentSlot = { extensions: [helpCommand({})], required: true } as const;

// Each config object's `extensions` slot is typed by its own target.
// @ts-expect-error TS2345: An option extension does not apply to a Command.
const commandValue = new Command('wrong', commandSlot);
// @ts-expect-error TS2345: A Command extension does not apply to an option.
const optionValue = new Command('wrong').option('raw', optionSlot);
// @ts-expect-error TS2345: A Command extension does not apply to an argument.
const argumentValue = new Command('wrong').argument('path', argumentSlot);

// An activation list names the plugin's own options, so an undeclared name cannot compile.
// @ts-expect-error TS2322: The plugin declares no "hlep" option.
const misnamed = plugin('@fixture/bad', { middleware: activation, options: declared });

// A plugin option carries no schema and no presence rule.
// @ts-expect-error TS2322: A plugin option declares no schema.
const validated = { level: { type: 'string', validate: z.string() } } satisfies PluginOptions;
// @ts-expect-error TS2322: A plugin option declares no absence rule.
const omitted = { level: { type: 'string', validateOmitted: true } } satisfies PluginOptions;
// @ts-expect-error TS2322: A plugin option declares no presence rule.
const presence = { level: { required: true, type: 'string' } } satisfies PluginOptions;

// A plugin option carries the two listing facts, as an application's own option does.
const listed = {
  level: { deprecated: 'Use --verbosity instead.', hidden: true, type: 'string' },
} satisfies PluginOptions;

// The installed list holds plugin values alone.
// @ts-expect-error TS2741: A forged object is not the value plugin() returns.
const installed: readonly Plugin[] = [forged];

const [option] = app.inspect().globals;
if (!option) {
  throw new Error('The application declares one global option.');
}

// A read takes the node kind its own descriptor targets.
// @ts-expect-error TS2345: A Command descriptor never reads an option node.
const wrongNode = readExtension(option, helpCommand);

const reader: Middleware<typeof help> = ({ options }) => {
  // @ts-expect-error TS2339: The plugin declares no "verbose" option.
  void options.verbose;
};

// A plugin's own list holds descriptors, which publish an identity and a target.
const defined: readonly AnyExtension[] = [helpCommand, helpInput, helpArgument];
const carried: ExtensionValue<'command'> = helpCommand({});
// @ts-expect-error TS2739: An extension value publishes its brand alone, never a descriptor's keys.
const valueAsDescriptor: AnyExtension = carried;

void defined;
void valueAsDescriptor;
void commandValue;
void optionValue;
void argumentValue;
void misnamed;
void validated;
void omitted;
void presence;
void listed;
void installed;
void wrongNode;
void reader;
void helpArgument;
