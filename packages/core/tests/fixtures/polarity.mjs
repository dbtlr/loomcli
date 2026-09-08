import { Application } from '@loomcli/core';

await new Application('polarity')
  .option('total', { polarity: 'both', short: 't', type: 'boolean' })
  .option('color', { polarity: 'negative', short: 'c', type: 'boolean' })
  .option('silent', { polarity: 'negative', short: 's', shortOnly: true, type: 'boolean' })
  .option('metric', { short: 'm', shortOnly: true, type: 'string' })
  .action(({ options, passthrough, out }) => out.print(JSON.stringify({ options, passthrough })))
  .run();
