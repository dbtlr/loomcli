import { appendFileSync } from 'node:fs';

import { Application, Command, processHandle } from '@loomcli/core';
import { selfUpdate } from '@loomcli/plugins/self-update';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';

/*
 * One run, under Node, of an application that installs `selfUpdate()` with its update notices on,
 * so the run loads the notices' middleware and the installed-files module behind it. When the run
 * ends, the line `node:crypto` goes to the file `LOOM_FIXTURE_MARKS` names if the process loaded
 * that built-in by any route.
 */

const app = new Application('notes', {
  description: 'A fixture application.',
  plugins: [selfUpdate()],
  version: '1.0.0',
}).command(
  new Command('add', { description: 'Add a note.' }).action(({ out }) =>
    out.success('Added note 12.'),
  ),
);

process.exitCode = await app.run({
  process: processHandle({ argv: process.argv.slice(2), home: fixtureHome() }),
});

// Node lists every built-in it has loaded, by a static import or by process.getBuiltinModule alike.
if (process.moduleLoadList.includes('NativeModule crypto')) {
  appendFileSync(process.env.LOOM_FIXTURE_MARKS, 'node:crypto\n');
}
