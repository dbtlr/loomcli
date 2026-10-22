import { Application, DeclarationError, InternalError, override } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';
import { oneOf } from '@loomcli/validators';

import { calc } from './commands/calc.js';
import { convert } from './commands/convert.js';
import { splits } from './commands/splits.js';
import { splitTooLong } from './failures.js';
import { defectView } from './views.js';

// #region application
const configured = new Application('pace', {
  description: 'Work out running paces, splits, and conversions.',
  plugins: [help(), version(), format()],
  translators: [splitTooLong],
  views: [override(InternalError, defectView), override(DeclarationError, defectView)],
}).globalOption('unit', {
  default: 'km',
  description: 'The unit to give a pace in.',
  env: 'PACE_UNIT',
  short: 'u',
  type: 'string',
  validate: oneOf(['km', 'mi']),
});
// #endregion

// Each Command reads the types of the global options through this registration.
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export const pace = configured.command(calc).command(splits).command(convert);
