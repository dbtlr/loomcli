import { Command, plugin } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';

import Package from '../package.json' with { type: 'json' };

// This package compiles outside any Application's registration, so the Command requires no globals.
const doctorCommand = new Command('doctor', {
  description: 'Check the host this application runs on.',
}).action(({ out }) => out.print('All checks passed.'));

/** A plugin that attaches one ordinary Command to the root of the Application that installs it. */
export function doctor(): Plugin {
  return plugin(Package.name, { commands: [doctorCommand] });
}
