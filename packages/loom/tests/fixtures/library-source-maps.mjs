import { fileURLToPath } from 'node:url';

import { Application, Command } from '@loomcli/core';
import { manpage } from '@loomcli/plugins/manpage';

const scenario = process.argv[2];
const outcome = await (scenario === 'action'
  ? new Application('maps', { plugins: [manpage()] }).invoke(['manpage', 'generate'], {
      options: { out: fileURLToPath(import.meta.url) },
    })
  : new Application('maps')
      .command(
        new Command('run')
          .option('word', {
            type: 'string',
            validate: {
              '~standard': {
                validate() {
                  throw new Error('Fixture validator failed.');
                },
                vendor: 'fixture',
                version: 1,
              },
            },
          })
          .action(() => undefined),
      )
      .invoke(['run'], { options: { word: 'x' } }));
if (outcome.status !== 'failed') {
  throw new Error('Expected a failed invocation.');
}
process.stdout.write(outcome.failure.stack);
