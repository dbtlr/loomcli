import { Application, Command } from '@loomcli/core';

const report =
  (command) =>
  ({ args, options, passthrough, out }) =>
    out.print(JSON.stringify({ args, command, options, passthrough }));

const get = new Command('get').argument('path', { required: true }).action(report('get'));

const keys = new Command('keys').action(report('keys'));

// The unnamed root is a group too: it attaches children and registers no action of its own.
const app = new Application('nested-root')
  .globalOption('file', { short: 'f', type: 'string' })
  .command(get)
  .command(keys);

await app.run({ host: { argv: process.argv.slice(3) } });
