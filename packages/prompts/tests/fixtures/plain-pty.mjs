import { Application, processHandle } from '@loomcli/core';
import { plain } from '@loomcli/plugins/plain';

import { progress } from '../../dist/index.js';

/** An async iterable that yields each part after a short pause, as a model's answer arrives. */
async function* answer() {
  for (const part of [
    'Loom is a toolkit for',
    ' command-line applications.\nIt parses, rou',
    'tes, and renders.',
  ]) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    yield part;
  }
}

/**
 * One run with `--plain` on the real terminal: a progress line that updates and spins for long
 * enough to tick, and a streamed message, then the mark the driver waits for.
 */
await new Application('plain', {
  description: 'Show progress and a streamed answer with the plain switch on.',
  plugins: [plain()],
})
  .action(async (context) => {
    const line = progress(context, { label: 'Fetching records', total: 4 });
    for (let completed = 1; completed <= 4; completed += 1) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      line.update({ completed });
    }
    await line.end('Fetched 4 records');
    await context.out.info(answer());
  })
  .run({
    process: processHandle({ argv: ['--plain'] }),
    rendering: { color: 'never', modifiers: 'never' },
  });
process.stdout.write('@@DONE@@\n');
