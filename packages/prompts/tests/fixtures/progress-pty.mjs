import { Application, processHandle, style } from '@loomcli/core';
import { theme } from '@loomcli/plugins/theme';

import { progress, progressStyle } from '../../dist/index.js';

/**
 * A mark in the terminal transcript that the emulator ignores: an OSC the test splits the
 * transcript at. It is written straight to stderr once the writes before it have completed.
 */
function mark(name) {
  process.stderr.write(`\u001B]7777;${name}\u0007`);
}

/** Resolves once the frames queued before it have reached the terminal. */
function settled() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * One run on the real terminal: a lane line, then three progress lines. The middle one is cleared
 * while the others run, then the top one is skipped and the bottom one warned. The dim token is
 * faint and the warning token yellow, so the test reads each from a cell.
 */
await new Application('ends', {
  description: 'Skip, warn, and clear progress lines on a real terminal.',
  plugins: [
    progressStyle({ spinner: { frames: ['◐'], interval: 60_000 } }),
    theme({ dim: style.faint, warning: style.yellow }),
  ],
})
  .action(async (context) => {
    await context.out.info('lane line');
    const fetching = progress(context, { label: 'Fetching records' });
    const reading = progress(context, { label: 'Reading the cache' });
    const more = progress(context, { label: 'Fetching more', total: 120 });
    more.update({ completed: 118 });
    await settled();
    mark('running');
    await reading.clear();
    mark('cleared');
    await fetching.skip('Fetched nothing: the cache is fresh');
    await more.warn('Fetched 118 of 120 records');
    mark('ended');
  })
  .run({
    process: processHandle({ argv: [] }),
    rendering: { color: 'always', modifiers: 'always' },
  });
process.stdout.write('@@DONE@@\n');
