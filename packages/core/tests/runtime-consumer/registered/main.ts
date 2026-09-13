import { Application, GlobalOptions, readExtension } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';

import { greet } from '../library/dist/command.js';
import { local } from './local.js';

const configured = new Application('registered', {
  globals: new GlobalOptions().option('trace', { type: 'boolean' }),
  plugins: [help()],
});
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}
const app = configured
  .command(greet.extend(helpCommand({ details: 'Application details.' })))
  .command(local);
const child = app.inspect().root.children[0];
if (!child || readExtension(child, helpCommand)?.details !== 'Application details.') {
  throw new Error('The enriched library Command lost its typed help value.');
}
await app.run();
