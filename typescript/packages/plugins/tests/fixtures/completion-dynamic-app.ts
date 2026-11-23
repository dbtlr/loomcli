import { Application, Command } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { completionArgument, completionInput } from '@loomcli/plugins/completion/extension';

/**
 * An application whose `task` Command takes an option and an argument whose values the author's
 * own code supplies at Tab time, as an issue tracker's task ids: two ids with a description each,
 * and one without.
 */
function completionDynamicApplication() {
  const task = new Command('task', { description: 'Work on a task.' })
    .option('id', {
      extensions: [completionInput({ values: 'task' })],
      short: 'i',
      type: 'string',
    })
    .argument('ref', { extensions: [completionArgument({ values: 'task' })] })
    .action(() => {});

  return new Application('kit', {
    plugins: [
      completion({
        values: {
          task: async ({ word }) => {
            await Promise.resolve();
            return [
              { description: 'Fix the build.', value: 'task-1' },
              { description: 'Write the docs.', value: 'task-2' },
              'zeta',
            ].filter((entry) => (typeof entry === 'string' ? entry : entry.value).startsWith(word));
          },
        },
      }),
    ],
  }).command(task);
}

export { completionDynamicApplication };
