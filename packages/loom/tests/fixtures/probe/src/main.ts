import { Application } from '@loomcli/core';

import packet from '../loom.packet.json' with { type: 'json' };

// A probe whose action throws a foreign error, so the build decides what its operator reads.
await new Application('probe', { description: 'Probe a build.', packet })
  .action(() => {
    throw new TypeError('The probe cannot read its input.');
  })
  .run();
