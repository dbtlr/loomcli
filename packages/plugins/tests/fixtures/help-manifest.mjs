import { Application, Command, plugin, readExtension } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { mockProcess } from '@loomcli/testing';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args = [], env = {}) {
  const status = 0;
  const output = mockProcess({ env });
  const handles = [output];
  const current = output;

  const scenario = args[0];

  /** The root's help: prose and one example. */
  const rootHelp = helpCommand({
    commandSections: [['Work', 'Read']],
    details: 'The whole fixture.\nIts second line.',
    examples: [{ command: 'noted x', note: 'One example.' }],
    optionSections: [['Output']],
    section: ['Root'],
  });

  /** Four Commands: help examples with an author value, an empty help value, none, and details alone. */

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

  const byName = Object.fromEntries(
    graph.root.children.map((child) => [child.name, manifest(child)]),
  );

  current.stdout.write(`${JSON.stringify({ root: manifest(graph.root), ...byName })}\n`);

  const noted = graph.root.children.find((child) => child.name === 'noted');

  current.stdout.write(
    `${JSON.stringify({ helpOnNoted: readExtension(noted, helpCommand) ?? null })}\n`,
  );
  return {
    status: current.exitCode ?? status,
    stderr: handles.map((handle) => handle.stderr.text).join(''),
    stdout: handles.map((handle) => handle.stdout.text).join(''),
  };
}

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
      new Command('detailed', {
        extensions: [helpCommand({ details: 'Details alone.' })],
      }).action(() => {}),
    );
}
const manifest = (node) => readExtension(node, manifestCommand);
export { run };
