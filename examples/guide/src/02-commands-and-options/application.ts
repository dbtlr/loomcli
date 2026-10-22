import { Application } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';

import { calc } from './commands/calc.js';
import { convert } from './commands/convert.js';
import { splits } from './commands/splits.js';

const configured = new Application('pace', {
  description: 'Work out running paces, splits, and conversions.',
  plugins: [help(), version()],
}).globalOption('unit', {
  description: 'The unit to give a pace in, km or mi.',
  short: 'u',
  type: 'string',
});

// Each Command reads the types of the global options through this registration.
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export const pace = configured.command(calc).command(splits).command(convert);
