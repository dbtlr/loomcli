import { Application, processHandle } from '@loomcli/core';

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

/**
 * One run on the real terminal: a lane line, then a tree whose first task ends and whose second
 * logs a line while it runs. The tree succeeds, which collapses its tasks. A second tree's first
 * task ends and its second logs a line, then the tree fails, which its open task takes, so its
 * tasks stay under it with the failed task's kept line above its end line. The spinner has one
 * frame and redraws every 20 ms, so the rows show at the next frame and read the same at every
 * frame.
 */
await new Application('deploy', {
  description: 'Show task groups on a real terminal.',
  plugins: [progressStyle({ spinner: { frames: ['◐'], interval: 20 } })],
})
  .action(async (context) => {
    await context.out.info('lane line');
    const deploying = progress(context, { label: 'Deploying' });
    const building = deploying.task({ label: 'Building the image' });
    const pushing = deploying.task({ label: 'Pushing the image' });
    await pushing.log('Pushed layer 1');
    await building.end('Built the image');
    await settled();
    mark('running');
    await pushing.end('Pushed the image');
    await deploying.end('Deployed');
    await settled();
    mark('collapsed');
    const releasing = progress(context, { label: 'Releasing' });
    const tagging = releasing.task({ label: 'Tagging' });
    const publishing = releasing.task({ label: 'Publishing' });
    await publishing.log('npm error code E403');
    await tagging.end('Tagged');
    await settled();
    await releasing.fail();
    await settled();
    mark('failed');
  })
  .run({ process: processHandle({ argv: [] }) });
process.stdout.write('@@DONE@@\n');
