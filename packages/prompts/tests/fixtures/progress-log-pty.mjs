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
  return new Promise((resolve) => setTimeout(resolve, 100));
}

/** `count` numbered lines of a child program's output, each ended with a line break. */
function output(count) {
  let text = '';
  for (let number = 1; number <= count; number += 1) {
    text += `npm http fetch ${String(number)}\n`;
  }
  return text;
}

/**
 * One run on the real terminal: a lane line, then two progress lines with logs. The top line's log
 * holds 7 lines, so its newest 5 show, and the bottom line's one. The top line ends, which removes
 * its rows, then the bottom line fails, which writes its kept line above its failure line. The dim
 * token is faint, so the test reads the dim rows from a cell. The spinner has one frame and redraws
 * every 20 ms, so the rows show at the next frame and the line reads the same at every frame.
 */
await new Application('install', {
  description: 'Show progress lines with logs on a real terminal.',
  plugins: [
    progressStyle({ spinner: { frames: ['◐'], interval: 20 } }),
    theme({ dim: style.faint }),
  ],
})
  .action(async (context) => {
    await context.out.info('lane line');
    const installing = progress(context, { label: 'Installing dependencies' });
    const building = progress(context, { label: 'Building' });
    await installing.log(output(7));
    await building.log('tsc error TS2304');
    await settled();
    mark('running');
    await installing.end('Installed dependencies');
    await settled();
    mark('ended');
    await building.fail();
    await settled();
    mark('failed');
  })
  .run({
    process: processHandle({ argv: [] }),
    rendering: { color: 'always', modifiers: 'always' },
  });
process.stdout.write('@@DONE@@\n');
