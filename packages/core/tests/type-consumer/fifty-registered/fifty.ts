import { Application, Command } from '@loomcli/core';
import type { PathsOf } from '@loomcli/core';

// The fifty fixture with its Command paths registered, so an action's invoke reads them.
// Fifty-one Commands: ten groups of four leaves under the root, the ten groups, and a relay.
// The editor-latency script measures an Application this size, so its numbers show what a larger graph costs.

const leaf00 = new Command('leaf0', { description: 'Leaf 0 of group 0.' })
  .argument('target', { required: true })
  .option('level0', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf01 = new Command('leaf1', { description: 'Leaf 1 of group 0.' })
  .argument('target', { required: true })
  .option('level1', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf02 = new Command('leaf2', { description: 'Leaf 2 of group 0.' })
  .argument('target', { required: true })
  .option('level2', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf03 = new Command('leaf3', { description: 'Leaf 3 of group 0.' })
  .argument('target', { required: true })
  .option('level3', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const group0 = new Command('group0', { description: 'Group 0.' })
  .option('scope', { type: 'string' })
  .command(leaf00)
  .command(leaf01)
  .command(leaf02)
  .command(leaf03);

const leaf10 = new Command('leaf0', { description: 'Leaf 0 of group 1.' })
  .argument('target', { required: true })
  .option('level0', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf11 = new Command('leaf1', { description: 'Leaf 1 of group 1.' })
  .argument('target', { required: true })
  .option('level1', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf12 = new Command('leaf2', { description: 'Leaf 2 of group 1.' })
  .argument('target', { required: true })
  .option('level2', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf13 = new Command('leaf3', { description: 'Leaf 3 of group 1.' })
  .argument('target', { required: true })
  .option('level3', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const group1 = new Command('group1', { description: 'Group 1.' })
  .option('scope', { type: 'string' })
  .command(leaf10)
  .command(leaf11)
  .command(leaf12)
  .command(leaf13);

const leaf20 = new Command('leaf0', { description: 'Leaf 0 of group 2.' })
  .argument('target', { required: true })
  .option('level0', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf21 = new Command('leaf1', { description: 'Leaf 1 of group 2.' })
  .argument('target', { required: true })
  .option('level1', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf22 = new Command('leaf2', { description: 'Leaf 2 of group 2.' })
  .argument('target', { required: true })
  .option('level2', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf23 = new Command('leaf3', { description: 'Leaf 3 of group 2.' })
  .argument('target', { required: true })
  .option('level3', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const group2 = new Command('group2', { description: 'Group 2.' })
  .option('scope', { type: 'string' })
  .command(leaf20)
  .command(leaf21)
  .command(leaf22)
  .command(leaf23);

const leaf30 = new Command('leaf0', { description: 'Leaf 0 of group 3.' })
  .argument('target', { required: true })
  .option('level0', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf31 = new Command('leaf1', { description: 'Leaf 1 of group 3.' })
  .argument('target', { required: true })
  .option('level1', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf32 = new Command('leaf2', { description: 'Leaf 2 of group 3.' })
  .argument('target', { required: true })
  .option('level2', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf33 = new Command('leaf3', { description: 'Leaf 3 of group 3.' })
  .argument('target', { required: true })
  .option('level3', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const group3 = new Command('group3', { description: 'Group 3.' })
  .option('scope', { type: 'string' })
  .command(leaf30)
  .command(leaf31)
  .command(leaf32)
  .command(leaf33);

const leaf40 = new Command('leaf0', { description: 'Leaf 0 of group 4.' })
  .argument('target', { required: true })
  .option('level0', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf41 = new Command('leaf1', { description: 'Leaf 1 of group 4.' })
  .argument('target', { required: true })
  .option('level1', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf42 = new Command('leaf2', { description: 'Leaf 2 of group 4.' })
  .argument('target', { required: true })
  .option('level2', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf43 = new Command('leaf3', { description: 'Leaf 3 of group 4.' })
  .argument('target', { required: true })
  .option('level3', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const group4 = new Command('group4', { description: 'Group 4.' })
  .option('scope', { type: 'string' })
  .command(leaf40)
  .command(leaf41)
  .command(leaf42)
  .command(leaf43);

const leaf50 = new Command('leaf0', { description: 'Leaf 0 of group 5.' })
  .argument('target', { required: true })
  .option('level0', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf51 = new Command('leaf1', { description: 'Leaf 1 of group 5.' })
  .argument('target', { required: true })
  .option('level1', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf52 = new Command('leaf2', { description: 'Leaf 2 of group 5.' })
  .argument('target', { required: true })
  .option('level2', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf53 = new Command('leaf3', { description: 'Leaf 3 of group 5.' })
  .argument('target', { required: true })
  .option('level3', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const group5 = new Command('group5', { description: 'Group 5.' })
  .option('scope', { type: 'string' })
  .command(leaf50)
  .command(leaf51)
  .command(leaf52)
  .command(leaf53);

const leaf60 = new Command('leaf0', { description: 'Leaf 0 of group 6.' })
  .argument('target', { required: true })
  .option('level0', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf61 = new Command('leaf1', { description: 'Leaf 1 of group 6.' })
  .argument('target', { required: true })
  .option('level1', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf62 = new Command('leaf2', { description: 'Leaf 2 of group 6.' })
  .argument('target', { required: true })
  .option('level2', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf63 = new Command('leaf3', { description: 'Leaf 3 of group 6.' })
  .argument('target', { required: true })
  .option('level3', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const group6 = new Command('group6', { description: 'Group 6.' })
  .option('scope', { type: 'string' })
  .command(leaf60)
  .command(leaf61)
  .command(leaf62)
  .command(leaf63);

const leaf70 = new Command('leaf0', { description: 'Leaf 0 of group 7.' })
  .argument('target', { required: true })
  .option('level0', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf71 = new Command('leaf1', { description: 'Leaf 1 of group 7.' })
  .argument('target', { required: true })
  .option('level1', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf72 = new Command('leaf2', { description: 'Leaf 2 of group 7.' })
  .argument('target', { required: true })
  .option('level2', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf73 = new Command('leaf3', { description: 'Leaf 3 of group 7.' })
  .argument('target', { required: true })
  .option('level3', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const group7 = new Command('group7', { description: 'Group 7.' })
  .option('scope', { type: 'string' })
  .command(leaf70)
  .command(leaf71)
  .command(leaf72)
  .command(leaf73);

const leaf80 = new Command('leaf0', { description: 'Leaf 0 of group 8.' })
  .argument('target', { required: true })
  .option('level0', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf81 = new Command('leaf1', { description: 'Leaf 1 of group 8.' })
  .argument('target', { required: true })
  .option('level1', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf82 = new Command('leaf2', { description: 'Leaf 2 of group 8.' })
  .argument('target', { required: true })
  .option('level2', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf83 = new Command('leaf3', { description: 'Leaf 3 of group 8.' })
  .argument('target', { required: true })
  .option('level3', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const group8 = new Command('group8', { description: 'Group 8.' })
  .option('scope', { type: 'string' })
  .command(leaf80)
  .command(leaf81)
  .command(leaf82)
  .command(leaf83);

const leaf90 = new Command('leaf0', { description: 'Leaf 0 of group 9.' })
  .argument('target', { required: true })
  .option('level0', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf91 = new Command('leaf1', { description: 'Leaf 1 of group 9.' })
  .argument('target', { required: true })
  .option('level1', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf92 = new Command('leaf2', { description: 'Leaf 2 of group 9.' })
  .argument('target', { required: true })
  .option('level2', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const leaf93 = new Command('leaf3', { description: 'Leaf 3 of group 9.' })
  .argument('target', { required: true })
  .option('level3', { type: 'string' })
  .option('force', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(`${args.target} ${String(options.force)}`));

const group9 = new Command('group9', { description: 'Group 9.' })
  .option('scope', { type: 'string' })
  .command(leaf90)
  .command(leaf91)
  .command(leaf92)
  .command(leaf93);

const relay = new Command('relay', { description: 'Runs another Command by name.' }).action(
  async ({ invoke, out }) => {
    const outcome = await invoke(['group4', 'leaf2'], {
      args: { target: 'x' },
      options: { force: true },
    });
    out.print(outcome.status);
  },
);

declare module '@loomcli/core' {
  interface Register {
    paths: PathsOf<typeof fifty>;
  }
}

export const fifty = new Application('fifty')
  .globalOption('verbose', { type: 'count' })
  .globalOption('config', { type: 'string' })
  .command(group0)
  .command(group1)
  .command(group2)
  .command(group3)
  .command(group4)
  .command(group5)
  .command(group6)
  .command(group7)
  .command(group8)
  .command(group9)
  .command(relay);

export const outcome = fifty.invoke(['group7', 'leaf3'], {
  args: { target: 'y' },
  options: { level3: 'high' },
});
