import { Application, Command } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';

/**
 * One run of an application that pages its help, on the real process. `LOOM_FIXTURE_SCENARIO` picks
 * the page: `notes` holds about twenty lines, and `large` a description larger than a pipe's buffer,
 * so a pager that quits before reading closes the pipe while help still writes.
 */
const large = process.env.LOOM_FIXTURE_SCENARIO === 'large';
let app = new Application('notes', {
  description: large ? 'Keep notes in a folder. '.repeat(8000).trim() : 'Keep notes in a folder.',
  plugins: [help({ paging: true })],
});
for (const name of ['add', 'edit', 'list', 'move', 'remove', 'show', 'sync', 'tag']) {
  app = app.command(
    new Command(name, { description: `Run ${name} on the notes.` }).action(() => undefined),
  );
}
await app.run();
