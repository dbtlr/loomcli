import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

import { Application } from '@loomcli/core';
import { box } from '@loomcli/plugins/box';
import { rule } from '@loomcli/plugins/rule';

/** Resizes the pseudo-terminal this process runs on, then waits until stdout reports the width. */
async function resize(columns) {
  spawnSync('stty', ['cols', String(columns), 'rows', '30'], { stdio: 'inherit' });
  for (let tries = 0; tries < 500 && process.stdout.columns !== columns; tries += 1) {
    await sleep(10);
  }
}

const summary = 'All three services passed their health checks, and the deploy can continue.';

await new Application('pty-pack-views', {
  description: 'Render a rule and a box either side of a resize.',
})
  .action(async ({ out }) => {
    await resize(100);
    await out.render('Checks', rule());
    await out.render(summary, box({ title: 'Result' }));
    await resize(60);
    await out.render('Checks', rule());
    await out.render(summary, box({ title: 'Result' }));
    await out.print('@@DONE@@');
  })
  .run({
    host: { argv: [] },
    rendering: { color: 'never', modifiers: 'never' },
  });
