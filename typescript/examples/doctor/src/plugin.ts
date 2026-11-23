import { Command, plugin } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';
import { box } from '@loomcli/plugins/box';
import { heading } from '@loomcli/plugins/heading';
import { list } from '@loomcli/plugins/list';
import { rule } from '@loomcli/plugins/rule';

import { packageName } from './constants.js';

// This package compiles outside any Application's registration, so the Command requires no globals.
const doctorCommand = new Command('doctor', {
  description: 'Check the host this application runs on.',
}).action(async ({ host, out }) => {
  const output = host.terminal.stdout.isTTY ? 'a terminal' : 'not a terminal';
  await out.render('Host checks', heading());
  await out.render([`Platform: ${host.platform}`, `Output: ${output}`], list<string>());
  await out.render('', rule());
  await out.render('All checks passed.', box({ title: 'Result' }));
});

/** A plugin that attaches one ordinary Command to the root of the Application that installs it. */
export function doctor(): Plugin {
  return plugin(packageName, { commands: [doctorCommand] });
}
