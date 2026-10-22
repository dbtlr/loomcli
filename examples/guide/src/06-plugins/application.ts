import { Application, FatalError, InternalError, override } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { suggestions } from '@loomcli/plugins/suggestions';
import { version } from '@loomcli/plugins/version';
import { oneOf } from '@loomcli/validators';

import { calc } from './commands/calc.js';
import { convert } from './commands/convert.js';
import { splits } from './commands/splits.js';
import { splitTooLong } from './failures.js';
import { races } from './races.js';
import { defectView, fatalView } from './views.js';

const configured = new Application('pace', {
  description: 'Work out running paces, splits, and conversions.',
  // Installation order is composition order: help and version answer before any later plugin.
  plugins: [help(), suggestions(), version(), format(), config(), completion(), races()],
  translators: [splitTooLong],
  views: [override(FatalError, fatalView), override(InternalError, defectView)],
}).globalOption('unit', {
  default: 'km',
  description: 'The unit to give a pace in.',
  env: 'PACE_UNIT',
  // An operator can set the unit in .pace.json, in the working directory or the home directory.
  extensions: [configInput({ path: 'unit' })],
  short: 'u',
  type: 'string',
  validate: oneOf(['km', 'mi']),
});

// Each Command reads the types of the global options through this registration.
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export const pace = configured.command(calc).command(splits).command(convert);
