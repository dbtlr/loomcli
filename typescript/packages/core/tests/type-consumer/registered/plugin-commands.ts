import { Command, plugin } from '@loomcli/core';

// A Command built where an Application's registration is visible carries that Application's globals.
// A plugin's list requires none, so the Command must be built in the plugin's own compilation.
const local = new Command('local').action(() => undefined);

// @ts-expect-error TS2322: A registered Command requires the Application's globals.
plugin('registered/local', { commands: [local] });
