import { Application, processHandle } from '@loomcli/core';

import { progress, progressStyle } from '../../dist/index.js';

/**
 * A mark in the terminal transcript that the emulator ignores: an OSC the test splits the
 * transcript at. It is written straight to stderr once the writes before it have completed.
 */
function mark(name) {
  process.stderr.write(`\u001B]7777;${name}\u0007`);
}

/** Resolves after `ms` milliseconds, so the lines draw their frames meanwhile. */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Six numbered lines of one line's log. */
function output(name) {
  const rows = [];
  for (let number = 1; number <= 6; number += 1) {
    rows.push(`${name} line ${String(number)}`);
  }
  return rows.join('\n');
}

/**
 * One run on a real terminal 10 rows high: a lane line, then two progress lines that each log 6
 * lines, so together they would draw 12 rows without sharing the height. The spinner has one frame
 * and redraws every 20 ms, so the lines draw about a dozen frames each before both end.
 */
await new Application('install', {
  description: 'Show two logged progress lines on a short terminal.',
  plugins: [progressStyle({ spinner: { frames: ['◐'], interval: 20 } })],
})
  .action(async (context) => {
    await context.out.info('lane line');
    const first = progress(context, { label: 'install 1' });
    const second = progress(context, { label: 'install 2' });
    await first.log(output('install 1'));
    await second.log(output('install 2'));
    await wait(250);
    mark('running');
    await first.end();
    await second.end();
    await wait(100);
    mark('ended');
  })
  .run({ process: processHandle({ argv: [] }) });
process.stdout.write('@@DONE@@\n');
