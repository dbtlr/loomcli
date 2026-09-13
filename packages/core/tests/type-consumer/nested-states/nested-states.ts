import type { EnvironmentOf } from '@loomcli/core';
import { Application, Command } from '@loomcli/core';

// A named Command attaches children under the rules the unnamed root follows.

const leaf = new Command('clear').alias('cl').action(() => {});
const group = new Command('cache').alias('c', 'store').alias('depot').command(leaf);
const openAfterChild = group.option('verbose', { type: 'boolean' }).command(leaf);
const answered = openAfterChild.action(({ options, out }) => out.print(options.file));
const withArgument = new Command('get').argument('path', { required: true });

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
new Command('keys').alias();

// An alias invalidates no call, so it reads the same in every state before the action.
const aliasedArgument = withArgument.alias('g');
const aliasedGroup = group.alias('caches').command(leaf);

// @ts-expect-error TS2353: An attached value is a Command, whatever else it names.
new Command('cache').command({ name: 'clear' });

// Declaration emit must name a group's state, which keeps `command()` and `option()`.

const configured = new Application('registered').globalOption('file', {
  required: true,
  type: 'string',
});
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export { group, openAfterChild, answered, aliasedArgument, aliasedGroup };
