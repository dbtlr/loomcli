import { Application, Command, plugin, readExtension } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

const scenario = process.argv[2];

/** The root's help: prose and one example. */
const rootHelp = helpCommand({
  details: 'The whole fixture.\nIts second line.',
  examples: [{ command: 'noted x', note: 'One example.' }],
});

/** Four Commands: help examples with an author value, an empty help value, none, and details alone. */
function commands(app) {
  return app
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
      new Command('detailed', { extensions: [helpCommand({ details: 'Details alone.' })] }).action(
        () => {},
      ),
    );
}

/** A later hook that replaces the help value on `noted`, after help has read it. */
const replacing = plugin('@fixture/replacing', {
  onCommandAttach: (command) =>
    command.name === 'noted'
      ? command.extend(helpCommand({ details: 'Replaced after help.' }))
      : command,
});

const scenarios = {
  'no-help': () => commands(new Application('app', { extensions: [rootHelp] })),
  'replaced-later': () => commands(new Application('app', { plugins: [help(), replacing] })),
  supplied: () => commands(new Application('app', { extensions: [rootHelp], plugins: [help()] })),
};

const graph = scenarios[scenario]().inspect();
const manifest = (node) => readExtension(node, manifestCommand);
const byName = Object.fromEntries(
  graph.root.children.map((child) => [child.name, manifest(child)]),
);
process.stdout.write(`${JSON.stringify({ root: manifest(graph.root), ...byName })}\n`);
const noted = graph.root.children.find((child) => child.name === 'noted');
process.stdout.write(
  `${JSON.stringify({ helpOnNoted: readExtension(noted, helpCommand) ?? null })}\n`,
);
