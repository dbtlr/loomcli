import { Application, processHandle } from '@loomcli/core';
import { plain } from '@loomcli/plugins/plain';

import { confirm, editor, multiselect, progress, secret, select, text } from '../../dist/index.js';

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

// The editor question's editor, which leaves the file as it is and exits at once.
process.env.VISUAL = 'true';

/**
 * One run with `--plain` on the real terminal: a progress line that updates and spins for long
 * enough to tick, a streamed message, and each kind of question, then the answers and the mark
 * the driver waits for.
 */
await new Application('plain', {
  description: 'Show progress, a streamed answer, and every question with the plain switch on.',
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
    const answers = [
      await text(context, { default: 'my-app', message: 'Project name' }),
      await secret(context, { message: 'Token' }),
      await confirm(context, { default: false, message: 'Deploy now?' }),
      await select(context, {
        choices: ['sqlite', { disabled: 'needs an account', value: 'neon' }, 'postgres'],
        message: 'Storage backend',
      }),
      await multiselect(context, { choices: ['backups', 'telemetry'], message: 'Features' }),
      await select(context, { choices: ['metrics', 'alerts'], message: 'Feature', search: true }),
      await editor(context, { default: 'Notes', message: 'Release notes' }),
    ];
    await context.out.info(JSON.stringify(answers));
  })
  .run({
    process: processHandle({ argv: ['--plain'] }),
    rendering: { color: 'never', modifiers: 'never' },
  });
process.stdout.write('@@DONE@@\n');
