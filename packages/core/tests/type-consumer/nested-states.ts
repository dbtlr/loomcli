import { Command, GlobalOptions } from '@loomcli/core';

// A named Command attaches children under the rules the unnamed root follows.
const globals = new GlobalOptions().option('file', { required: true, type: 'string' });
const wider = new GlobalOptions()
  .option('file', { required: true, type: 'string' })
  .option('depth', { type: 'string' });

const leaf = new Command('clear', { globals }).alias('cl').action(() => {});
const group = new Command('cache', { globals }).alias('c', 'store').alias('depot').command(leaf);
const openAfterChild = group.option('verbose', { type: 'boolean' }).command(leaf);
const answered = openAfterChild.action(({ options, out }) => out.print(options.file));
const withArgument = new Command('get', { globals }).argument('path', { required: true });

// @ts-expect-error TS2339: A Command with children declares no arguments.
group.argument;
// @ts-expect-error TS2339: A Command with arguments attaches no children.
withArgument.command;
// @ts-expect-error TS2339: A Command that registered its action attaches no more children.
answered.command;
// @ts-expect-error TS2339: A Command that registered its action declares no more options.
answered.option;
// @ts-expect-error TS2339: A Command that registered its action declares no more aliases.
answered.alias;
// @ts-expect-error TS2555: An alias() call names at least one alias.
new Command('keys', { globals }).alias();

// An alias invalidates no call, so it reads the same in every state before the action.
const aliasedArgument = withArgument.alias('g');
const aliasedGroup = group.alias('caches').command(leaf);

const wideLeaf = new Command('wide', { globals: wider }).action(() => {});
const narrowLeaf = new Command('narrow', { globals }).action(() => {});
// @ts-expect-error TS2345: A child cannot declare globals its parent does not declare.
new Command('narrow', { globals }).command(wideLeaf);
// @ts-expect-error TS2345: A child cannot drop globals its parent declares.
new Command('wide', { globals: wider }).command(narrowLeaf);
// @ts-expect-error TS2353: An attached value is a Command, whatever else it names.
new Command('cache', { globals }).command({ name: 'clear' });

// Declaration emit must name a group's state, which keeps `command()` and `option()`.
export { group, openAfterChild, answered, aliasedArgument, aliasedGroup };
