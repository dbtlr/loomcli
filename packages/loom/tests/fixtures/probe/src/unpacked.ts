import { Application } from '@loomcli/core';

// The same probe given no packet, which is a distributed build wherever it runs.
await new Application('probe')
  .action(() => {
    throw new TypeError('The probe cannot read its input.');
  })
  .run();
