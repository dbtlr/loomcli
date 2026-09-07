import { Application, Command, GlobalOptions } from '@loom/core';

const digits = {
  '~standard': {
    validate: (value) =>
      /^\d+$/.test(value)
        ? { value: Number(value) }
        : { issues: [{ message: 'Use decimal digits.' }] },
    vendor: 'fixture',
    version: 1,
  },
};

const globals = new GlobalOptions()
  .option('file', { required: true, short: 'f', type: 'string' })
  .option('quiet', { short: 'q', type: 'boolean' })
  .option('limit', { type: 'string', validate: digits });

const report =
  (command) =>
  ({ args, options, passthrough, out }) =>
    out.print(JSON.stringify({ args, command, options, passthrough }));

const get = new Command('get', globals)
  .argument('path', { required: true })
  .option('raw', { short: 'r', type: 'boolean' })
  .action(report('get'));

const keys = new Command('keys', globals).action(report('keys'));

const app = new Application('jsonkit', { globals })
  .option('pretty', { short: 'p', type: 'boolean' })
  .command(get)
  .command(keys)
  .action(report('root'));

await app.run({ host: { argv: process.argv.slice(3) } });
