import { Application, Command } from '@loomcli/core';
import type { ReleaseFacts } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { manpage } from '@loomcli/plugins/manpage';

import { runOnMock } from './in-process.ts';

interface Scenario {
  commands?: readonly string[] | undefined;
  cwd: string;
  env: Record<string, string | undefined>;
  platform?: string | undefined;
  version?: string | undefined;
  release?: ReleaseFacts;
}

/** The same page set is declared for isolated runs and the process fixture. */
const command = (name: string) =>
  new Command(name, { description: `Run ${name}.` }).action(({ out }) => out.print(name));

function manpageApplication(scenario: Scenario) {
  const root = new Application('notes', {
    description: 'Keep notes in sync.',
    plugins: [help(), manpage()],
    version: scenario.version ?? '1.0.0',
  });
  const commands = scenario.commands ?? ['ping', 'sync'];

  const first = commands[0];
  if (first === undefined) {
    return root;
  }
  return commands
    .slice(1)
    .reduce((app, name) => app.command(command(name)), root.command(command(first)));
}

async function run(argv: string[], scenario: Scenario) {
  return await runOnMock(manpageApplication(scenario), {
    argv,
    cwd: scenario.cwd,
    env: scenario.env,
    home: scenario.env.HOME ?? '',
    platform: scenario.platform ?? 'linux',
    release: scenario.release ?? { build: 'distributed' },
  });
}

export { manpageApplication, run };
