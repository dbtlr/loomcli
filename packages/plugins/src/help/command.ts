import { Command, UnknownCommandError } from '@loomcli/core';
import type { CommandNode } from '@loomcli/core';

/**
 * The Command the words name, taken child by child from the root, each word the canonical name or an
 * alias of a child of the Command reached so far. Hidden and deprecated Commands resolve, as
 * `--help` after their path reaches them. A word that names no child is routing's unknown-command
 * failure, with the reached Command's offered children as its candidates.
 */
function commandAt(root: CommandNode, words: readonly string[]): CommandNode {
  let reached = root;
  for (const word of words) {
    const child = reached.children.find(
      ({ aliases, name }) => name === word || aliases.includes(word),
    );
    if (child === undefined) {
      throw new UnknownCommandError(word, offeredNames(reached));
    }
    reached = child;
  }
  return reached;
}

/** The canonical names of the children an operator may be pointed at, in authoring order. */
function offeredNames(command: CommandNode): string[] {
  return command.children
    .filter(({ deprecated, hidden }) => !hidden && deprecated === undefined)
    .flatMap(({ name }) => (name === null ? [] : [name]));
}

/**
 * The help Command for one `help()` call: `help [command...]` prints the extended page of the
 * Command its words name, the page `--help` after that path prints, paged under the same setting.
 * Each call builds its own value, because one Command value attaches to one parent. The page
 * module loads when the Command runs.
 */
export function helpCommandFor(paging: boolean) {
  return new Command('help', { description: 'Show help for a command.' })
    .argument('command', {
      description:
        'The command to show help for, as you would type it. The application itself when left out.',
      variadic: true,
    })
    .action(async (context) => {
      const { showPage } = await import('./show.js');
      const { graph } = context;
      const command = commandAt(graph.root, context.args.command);
      await showPage(context, { command, graph, variant: 'extended' }, paging);
    });
}
