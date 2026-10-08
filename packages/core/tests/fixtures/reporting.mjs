import { Application } from '@loomcli/core';

const code = await new Application('reporting')
  .action(() => {
    throw new Error('Action failed.');
  })
  .run({ host: { argv: [], release: { build: 'distributed' }, stderr: {} } });
process.stdout.write(`resolved:${code}\n`);
