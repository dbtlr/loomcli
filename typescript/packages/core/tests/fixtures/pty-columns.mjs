import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

import { Application, processHandle } from '@loomcli/core';

/** Resizes the pseudo-terminal this process runs on, then waits until stdout reports the width. */
async function resize(columns) {
  spawnSync('stty', ['cols', String(columns), 'rows', '30'], { stdio: 'inherit' });
  for (let tries = 0; tries < 500 && process.stdout.columns !== columns; tries += 1) {
    await sleep(10);
  }
}

const reading = (label) => ({
  render: (_value, context) => `${label}:${String(context.columns)}\n`,
});

await new Application('pty', { description: 'Render either side of a resize.' })
  .action(async ({ host, out }) => {
    await out.warn('one two three four five six seven eight nine ten eleven twelve');
    await resize(100);
    await out.render(null, reading('first'));
    await resize(60);
    await out.render(null, reading('second'));
    await out.print(
      `host:${String(host.terminal.stdout.columns)}:${String(host.terminal.stderr.columns)}`,
    );
    await out.print('@@DONE@@');
  })
  .run({
    process: processHandle({ argv: [] }),
    rendering: { color: 'never', modifiers: 'never' },
  });
