import { Application, Command, pad } from '@loomcli/core';

import packet from './loom.packet.json' with { type: 'json' };

// The application each bundler bundles without packet().
// `measure` pads wide, combining, and emoji text, so it reads core's Unicode tables.
// It prints the packet last, which reads development, because no writer touched it.
await new Application('bundled', { description: 'Measure bundled text.', packet })
  .command(
    new Command('measure', { description: 'Pad text to its width.' }).action(({ out }) => {
      for (const text of ['日本', 'é', '👩‍💻', '🇯🇵', 'abc']) {
        out.print(`${pad(text, 6)}|`);
      }
      out.print(packet.build);
    }),
  )
  .run({ host: { argv: process.argv.slice(2) } });
