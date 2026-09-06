import { Application } from '@loom/core';

const code = await new Application('reporting')
  .action(() => {
    throw new Error('Action failed.');
  })
  .run({ host: { argv: [], stderr: {} } });
process.stdout.write(`resolved:${code}\n`);
