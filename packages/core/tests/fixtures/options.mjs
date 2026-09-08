import { Application } from '@loomcli/core';

const app = new Application('options')
  .argument('files', { required: true, variadic: true })
  .option('metric', { short: 'm', type: 'string' })
  .option('total', { short: 't', type: 'boolean' })
  .action(({ args, options, passthrough, host, out }) => {
    out.print(JSON.stringify({ args, argv: host.argv, options, passthrough }));
  });

await app.run({ host: { argv: process.argv.slice(3) } });
