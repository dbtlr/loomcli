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
 * One run on the real terminal: a counted line with its rate and time left, whose reports land at
 * stated milliseconds on a clock the fixture sets, then its end. The dim token is faint, so the
 * test reads the dim parts from a cell.
 */
await new Application('estimate', {
  description: 'Show a progress line with its rate and time left on a real terminal.',
  plugins: [
    progressStyle({ spinner: { frames: ['◐'], interval: 3_600_000 } }),
    theme({ dim: style.faint }),
  ],
})
  .action(async (context) => {
    const realNow = Date.now;
    let now = 0;
    Date.now = () => now;
    try {
      const line = progress(context, {
        estimate: true,
        label: 'Copying files',
        total: 120,
        unit: 'files',
      });
      now = 500;
      line.update({ completed: 1 });
      now = 12_000;
      line.update({ completed: 40 });
      await settled();
      mark('running');
      now = 14_000;
      await line.end('Copied 120 files');
      mark('ended');
    } finally {
      Date.now = realNow;
    }
  })
  .run({
    process: processHandle({ argv: [] }),
    rendering: { color: 'always', modifiers: 'always' },
  });
process.stdout.write('@@DONE@@\n');
