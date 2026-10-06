import { Application, Command } from '@loomcli/core';

import packet from '../loom.packet.json' with { type: 'json' };

// The packed writer's fixture. `build` prints the packet the entry imported.
// `fail` throws a foreign error, so the build decides what its operator reads.
await new Application('packet-probe', { description: 'Probe the packed writer.', packet })
  .command(
    new Command('build', { description: 'Print the build.' }).action(({ out }) =>
      out.print(packet.build),
    ),
  )
  .command(
    new Command('fail', { description: 'Throw a foreign error.' }).action(() => {
      throw new TypeError('The probe cannot read its input.');
    }),
  )
  .run({ host: { argv: process.argv.slice(2) } });
