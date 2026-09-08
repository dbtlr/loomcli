import { Application, Command, GlobalOptions } from '@loomcli/core';

const globals = new GlobalOptions().option('file', { short: 'f', type: 'string' });

const report =
  (command) =>
  ({ args, options, passthrough, out }) =>
    out.print(JSON.stringify({ args, command, options, passthrough }));

const get = new Command('get', globals).argument('path', { required: true }).action(report('get'));

const keys = new Command('keys', globals).action(report('keys'));

// The unnamed root is a group too: it attaches children and registers no action of its own.
const app = new Application('nested-root', { globals }).command(get).command(keys);

await app.run({ host: { argv: process.argv.slice(3) } });
