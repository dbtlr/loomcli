import { Application, Command, GlobalOptions } from '@loom/core';

const report =
  (command) =>
  ({ args, options, out }) =>
    out.print(JSON.stringify({ args, command, options }));

const get = new Command('get').argument('path', { required: true }).action(report('get'));
const root = new Application('copies')
  .option('quiet', { short: 'q', type: 'boolean' })
  .action(report('root'));

// Each call returns a new declaration, so these three values share nothing but their receiver.
const forked = root.option('verbose', { type: 'boolean' });
const composed = root.command(get);

const empty = new GlobalOptions();
const shared = new Application('empty', empty)
  .action(report('root'))
  .command(new Command('leaf', empty).action(report('leaf')));

const declarations = { composed, forked, root, shared };
await declarations[process.argv[2]].run({ host: { argv: process.argv.slice(3) } });
