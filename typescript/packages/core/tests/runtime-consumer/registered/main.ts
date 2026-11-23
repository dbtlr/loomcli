import { Application, readExtension, style } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { theme } from '@loomcli/plugins/theme';

import { greet } from '../library/dist/command.js';
import { local, styled } from './local.js';

const configured = new Application('registered', {
  plugins: [help(), theme({ identifier: style.cyan.bold })],
  rendering: { color: 'never', modifiers: 'never' },
}).globalOption('trace', { type: 'boolean' });
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}
const app = configured
  .command(greet.extend(helpCommand({ details: 'Application details.' })))
  .command(local)
  .command(styled);
const child = app.inspect().root.children[0];
if (!child || readExtension(child, helpCommand)?.details !== 'Application details.') {
  throw new Error('The enriched library Command lost its typed help value.');
}
await app.run();
