import { Application, Command, optionSet } from '@loomcli/core';
import type { AttachedCommand, OptionGroup } from '@loomcli/core';

// A requirement names a declared local option, then each option it needs.
const login = new Command('login')
  .option('user', { type: 'string' })
  .option('password', { type: 'string' })
  .option('host', { type: 'string' })
  .requires('password', 'user')
  .requires('password', 'user', 'host')
  .action(({ options }) => options.password ?? options.user);

// @ts-expect-error TS2345: A requirement names only options the Command declares.
new Command('login').option('password', { type: 'string' }).requires('password', 'user');

// @ts-expect-error TS2345: The option that has the requirement is a declared option too.
new Command('login').option('user', { type: 'string' }).requires('password', 'user');

// @ts-expect-error TS2555: A requirement names at least one option it needs.
new Command('login').option('password', { type: 'string' }).requires('password');

new Command('login')
  .argument('user', {})
  .option('password', { type: 'string' })
  // @ts-expect-error TS2345: An argument is no member of a requirement.
  .requires('password', 'user');

new Application('login')
  .globalOption('user', { type: 'string' })
  .option('password', { type: 'string' })
  // @ts-expect-error TS2345: A global option is no member of a requirement.
  .requires('password', 'user');

// The root declares requirements over its own local options.
const root = new Application('login')
  .option('user', { type: 'string' })
  .option('password', { type: 'string' })
  .requires('password', 'user')
  .action(() => undefined);

// A set's requirement names the set's own members and returns a set that still applies.
const credentials = optionSet({
  password: { type: 'string' },
  user: { type: 'string' },
}).requires('password', 'user');
new Command('shared').options(credentials).action(({ options }) => options.user);

// @ts-expect-error TS2345: A set's requirement names only the set's own members.
optionSet({ password: { type: 'string' }, user: { type: 'string' } }).requires('password', 'host');

// @ts-expect-error TS2555: A set's requirement names at least one option it needs.
optionSet({ password: { type: 'string' }, user: { type: 'string' } }).requires('password');

// A plugin's hook declares a requirement over the erased Command it receives.
function hooked(command: AttachedCommand): AttachedCommand {
  return command
    .option('user', { type: 'string' })
    .option('password', { type: 'string' })
    .requires('password', 'user');
}

// @ts-expect-error TS2555: The erased form still names at least one option it needs.
const unneeded = (command: AttachedCommand) => command.requires('password');

// An inspected group narrows on its kind before its members are read.
function members(group: OptionGroup): readonly string[] {
  // @ts-expect-error TS2339: A requirement carries no options list, so a reader narrows kind first.
  void group.options;
  return group.kind === 'requires' ? [group.option, ...group.requires] : group.options;
}

export { credentials, hooked, login, members, root, unneeded };
