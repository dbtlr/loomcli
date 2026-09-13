import { Application, Command, GlobalOptions } from '@loomcli/core';

const read = new Command('read')
  .argument('path', { required: true })
  .option('raw', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(JSON.stringify({ args, options })));

const app = new Application('example', {
  globals: new GlobalOptions().option('quiet', { type: 'boolean' }).option('limit', {
    type: 'string',
    validate: {
      '~standard': {
        validate: (value) => ({ value: Number(value) }),
        vendor: 'fixture',
        version: 1,
      },
    },
  }),
}).command(read);

await app.run({ host: { argv: process.argv.slice(2) } });
