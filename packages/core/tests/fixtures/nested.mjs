import { Application, Command, GlobalOptions } from '@loom/core';

const globals = new GlobalOptions().option('file', { short: 'f', type: 'string' });

const report =
  (command) =>
  ({ args, options, passthrough, out }) =>
    out.print(JSON.stringify({ args, command, options, passthrough }));

const clear = new Command('clear', globals)
  .option('force', { short: 'F', type: 'boolean' })
  .action(report('clear'));

// Hidden aliases route like the canonical name, and a group carries them like any other Command.
const list = new Command('list', globals).alias('ls', 'l').action(report('list'));

// A Command with children and no action is a group; routing requires one of its children.
const cache = new Command('cache', globals).alias('c').command(clear).command(list);

// One namespace belongs to one parent, so "ls" is free here while "cache" already spends it.
const put = new Command('put', globals).alias('ls').action(report('put'));

// A Command with children and an action keeps its options and runs its action when it is selected.
const store = new Command('store', globals)
  .option('pretty', { short: 'p', type: 'boolean' })
  .command(put)
  .action(report('store'));

const app = new Application('nested', { globals })
  .command(cache)
  .command(store)
  .action(report('root'));

await app.run({ host: { argv: process.argv.slice(3) } });
