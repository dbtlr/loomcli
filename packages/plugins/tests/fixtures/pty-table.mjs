import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

import { Application, processHandle } from '@loomcli/core';
import { records } from '@loomcli/plugins/records';
import { table } from '@loomcli/plugins/table';

/** Resizes the pseudo-terminal this process runs on, then waits until stdout reports the width. */
async function resize(columns) {
  spawnSync('stty', ['cols', String(columns), 'rows', '30'], { stdio: 'inherit' });
  for (let tries = 0; tries < 500 && process.stdout.columns !== columns; tries += 1) {
    await sleep(10);
  }
}

const files = [
  { count: 6, source: 'docs/guides/getting started with the loom command line framework.md' },
  { count: 2, source: 'notes.md' },
];
const kind = 'array of 12 strings, none empty or longer than 40 characters';

/** Two records, the window resizing from 100 to 60 columns before the second is yielded. */
async function* members() {
  await resize(100);
  yield { key: 'before', kind };
  await resize(60);
  yield { key: 'after', kind };
}

const sizes = table({
  columns: [
    { align: 'right', header: 'COUNT', key: 'count' },
    { header: 'SOURCE', key: 'source' },
  ],
});

await new Application('pty-table', { description: 'Render a table either side of a resize.' })
  .action(async ({ out }) => {
    await resize(100);
    await out.render(files, sizes);
    await resize(60);
    await out.render(files, sizes);
    await out.render(members(), records({ identifier: 'key' }));
    await out.print('@@DONE@@');
  })
  .run({
    process: processHandle({ argv: [] }),
    rendering: { color: 'never', modifiers: 'never' },
  });
