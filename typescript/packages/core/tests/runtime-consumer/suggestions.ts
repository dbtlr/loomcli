import { Application, Command, processHandle } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';
import { suggestions } from '@loomcli/plugins/suggestions';

// The packed suggestions plugin offers the declared name nearest a mistyped Command.
const installed: Plugin = suggestions();

const app = new Application('packed-suggestions', { plugins: [installed] }).command(
  new Command('get').action(({ out }) => out.print('got')),
);

await app.run({ process: processHandle({ argv: process.argv.slice(2) }) });
