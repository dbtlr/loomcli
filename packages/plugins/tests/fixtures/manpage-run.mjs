import { readFileSync } from 'node:fs';

import { Application, Command, processHandle } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { manpage } from '@loomcli/plugins/manpage';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';

/**
 * One run of an application that installs `manpage()`. The scenario file, named by
 * `MANPAGE_SCENARIO`, holds the names of the Commands the application declares, its version, the
 * host's environment, working directory, and platform, and the umask.
 */
const scenario = JSON.parse(readFileSync(process.env.MANPAGE_SCENARIO, 'utf8'));
const argv = process.argv.slice(2);

if (scenario.umask !== undefined) {
  process.umask(scenario.umask);
}

const app = (scenario.commands ?? ['ping', 'sync']).reduce(
  (application, name) =>
    application.command(
      new Command(name, { description: `Run ${name}.` }).action(({ out }) => out.print(name)),
    ),
  new Application('notes', {
    description: 'Keep notes in sync.',
    plugins: [help(), manpage()],
    version: scenario.version ?? '1.0.0',
  }),
);

process.exitCode = await app.run({
  process: processHandle({
    argv,
    cwd: scenario.cwd,
    env: scenario.env,
    // The test's HOME, as given, so the user database's home is never the fixture's.
    home: fixtureHome(scenario.env),
    platform: scenario.platform ?? 'linux',
    release: scenario.release ?? { build: 'distributed' },
  }),
});
