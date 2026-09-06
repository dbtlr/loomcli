import { Application, Command, GlobalOptions } from '@loom/core';

const report =
  (command) =>
  ({ args, options, out }) =>
    out.print(JSON.stringify({ args, command, options }));

const get = new Command('get').argument('path', { required: true }).action(report('get'));
const base = new Application('copies').option('quiet', { short: 'q', type: 'boolean' });

// Each call returns a new declaration, so these three values share nothing but their receiver.
const root = base.action(report('root'));
const forked = base.option('verbose', { type: 'boolean' }).action(report('root'));
const composed = base.command(get).action(report('root'));

const empty = new GlobalOptions();
const shared = new Application('empty', empty)
  .command(new Command('leaf', empty).action(report('leaf')))
  .action(report('root'));

const declarations = { composed, forked, root, shared };
await declarations[process.argv[2]].run({ host: { argv: process.argv.slice(3) } });
