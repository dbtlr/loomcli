import { Application, Command, GlobalOptions } from '@loom/core';

const globals = new GlobalOptions().option('file', { short: 'f', type: 'string' });

const report =
  (command) =>
  ({ args, options, passthrough, out }) =>
    out.print(JSON.stringify({ args, command, options, passthrough }));

const clear = new Command('clear', globals)
  .option('force', { short: 'F', type: 'boolean' })
  .action(report('clear'));

const list = new Command('list', globals).action(report('list'));

// A Command with children and no action is a group; routing requires one of its children.
const cache = new Command('cache', globals).command(clear).command(list);

const put = new Command('put', globals).action(report('put'));

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
