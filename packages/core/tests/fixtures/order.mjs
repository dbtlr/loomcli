import { Application, Command, GlobalOptions } from '@loom/core';

/** Every supplied value fails, so the diagnostic lines report the validation order alone. */
const reject = (label) => ({
  '~standard': {
    validate: () => ({ issues: [{ message: `${label} rejected.` }] }),
    vendor: 'fixture',
    version: 1,
  },
});

const globals = new GlobalOptions()
  .option('alpha', { type: 'string', validate: reject('alpha') })
  .option('beta', { type: 'string', validate: reject('beta') });

const order = new Command('order', globals)
  .option('local', { type: 'string', validate: reject('local') })
  .argument('path', { required: true, validate: reject('path') })
  .action(({ out }) => out.print('order'));

const pair = new Command('pair', globals)
  .argument('one', { required: true })
  .argument('two', { required: true })
  .action(({ args, out }) => out.print(JSON.stringify(args)));

await new Application('order', { globals })
  .command(order)
  .command(pair)
  .action(({ out }) => out.print('root'))
  .run({ host: { argv: process.argv.slice(2) } });
