import { Application, Command } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { help } from '@loomcli/plugins/help';

/**
 * An application whose `help` Command takes the Commands a path has reached: `task` with children,
 * a second Command that starts with the same letter, and a hidden Command and a hidden child that
 * no listing offers.
 */
function completionHelpApplication() {
  const task = new Command('task', { description: 'Work with tasks.' })
    .command(new Command('show', { description: 'Show a task.' }).action(() => {}))
    .command(new Command('shelve', { description: 'Shelve a task.' }).action(() => {}))
    .command(new Command('shred', { hidden: true }).action(() => {}));

  return new Application('app', { plugins: [help({ command: true }), completion()] })
    .command(task)
    .command(new Command('team', { description: 'Work with teams.' }).action(() => {}))
    .command(new Command('tidy', { hidden: true }).action(() => {}));
}

export { completionHelpApplication };
