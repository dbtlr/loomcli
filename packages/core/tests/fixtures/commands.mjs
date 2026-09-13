import { Application, Command } from '@loomcli/core';

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

const report =
  (command) =>
  ({ args, options, passthrough, out }) =>
    out.print(JSON.stringify({ args, command, options, passthrough }));

const get = new Command('get')
  .argument('path', { required: true })
  .option('raw', { short: 'r', type: 'boolean' })
  .action(report('get'));

const keys = new Command('keys').action(report('keys'));

const app = new Application('jsonkit')
  .globalOption('file', { required: true, short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: digits })
  .option('pretty', { short: 'p', type: 'boolean' })
  .command(get)
  .command(keys)
  .action(report('root'));

await app.run({ host: { argv: process.argv.slice(3) } });
