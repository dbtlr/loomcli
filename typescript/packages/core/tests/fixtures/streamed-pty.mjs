import { Application, processHandle } from '@loomcli/core';

/**
 * A mark in the terminal transcript that the emulator ignores: an OSC the test splits the
 * transcript at. It is written straight to stderr once the writes before it have completed.
 */
function mark(name) {
  process.stderr.write(`\u001B]7777;${name}\u0007`);
}

const parts = [
  'Loom is a toolkit for',
  ' command-line applications.',
  ' It parses, rou',
  'tes, and renders.',
];

/**
 * One run that opens a live region, draws a frame, writes the answer through `info` above it,
 * streamed a chunk at a time or whole, and ends the region.
 */
async function answer(streamed) {
  await new Application('pty', { description: 'Stream an answer above a live region.' })
    .action(async ({ out }) => {
      const region = out.region();
      await region.draw(null, { render: () => 'Working' });
      if (streamed) {
        async function* text() {
          for (const [index, part] of parts.entries()) {
            yield part;
            // Core reads the next chunk once the writes of this one have completed.
            mark(`chunk-${String(index)}`);
          }
        }
        await out.info(text());
      } else {
        await out.info(parts.join(''));
      }
      await region.end();
    })
    .run({
      process: processHandle({ argv: [] }),
      rendering: { color: 'never', modifiers: 'never' },
    });
}

await answer(true);
mark('joined');
await answer(false);
process.stdout.write('@@DONE@@\n');
