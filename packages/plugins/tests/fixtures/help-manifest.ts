import type { ApplicationOptions, CommandNode } from '@loomcli/core';
import { Application, Command, plugin, readExtension } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

/** Report declaration outcomes through the public API. */
async function run(args: string[] = []) {
  let stdout = '';
  const write = (text: string) => {
    stdout += text;
  };

  const scenario = args[0];

  /** The root's help: prose and one example. */
  const rootHelp = helpCommand({
    commandSections: [['Work', 'Read']],
    details: 'The whole fixture.\nIts second line.',
    examples: [{ command: 'noted x', note: 'One example.' }],
    optionSections: [['Output']],
    section: ['Root'],
  });

  /** A later hook that replaces the help value on `noted`, after help has read it. */
  const replacing = plugin('@fixture/replacing', {
    onCommandAttach: (command) =>
      command.name === 'noted'
        ? command.extend(helpCommand({ details: 'Replaced after help.' }))
        : command,
  });

  const scenarios = {
    'no-help': () => commands({ extensions: [rootHelp] }),
    'replaced-later': () => commands({ plugins: [help(), replacing] }),
    supplied: () => commands({ extensions: [rootHelp], plugins: [help()] }),
  };

  const factory = Object.entries(scenarios).find(([name]) => name === scenario)?.[1];
  if (factory === undefined) {
    throw new Error(`Unknown scenario: ${scenario}`);
  }
  const graph = factory().inspect();

  const byName = Object.fromEntries(
    graph.root.children.map((child) => [child.name, manifest(child)]),
  );

  write(`${JSON.stringify({ root: manifest(graph.root), ...byName })}\n`);

  const noted = graph.root.children.find((child) => child.name === 'noted');

  if (noted === undefined) {
    throw new Error('The fixture declares noted.');
  }
  write(`${JSON.stringify({ helpOnNoted: readExtension(noted, helpCommand) ?? null })}\n`);
  return { stdout };
}

/** Four Commands: help examples with an author value, an empty help value, none, and details alone. */
function commands(options: ApplicationOptions) {
  return new Application('app', options)
    .command(
      new Command('noted', {
        extensions: [
          manifestCommand({ details: 'Only an agent needs this.' }),
          helpCommand({ examples: [{ command: 'noted y' }] }),
        ],
      }).action(() => {}),
    )
    .command(new Command('empty', { extensions: [helpCommand({})] }).action(() => {}))
    .command(new Command('plain').action(() => {}))
    .command(
      new Command('detailed', {
        extensions: [helpCommand({ details: 'Details alone.' })],
      }).action(() => {}),
    );
}
const manifest = (node: CommandNode) => readExtension(node, manifestCommand);
export { run };
