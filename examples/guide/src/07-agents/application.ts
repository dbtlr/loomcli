import { Application, InternalError, override } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { mcp } from '@loomcli/plugins/mcp';
import { suggestions } from '@loomcli/plugins/suggestions';
import { version } from '@loomcli/plugins/version';
import { oneOf } from '@loomcli/validators';

import { calc } from './commands/calc.js';
import { convert } from './commands/convert.js';
import { races } from './commands/races.js';
import { splits } from './commands/splits.js';
import { splitTooLong } from './failures.js';
import { raceHint } from './race-hint.js';
import { defectView } from './views.js';

const configured = new Application('pace', {
  description: 'Work out running paces, splits, and conversions.',
  // #region plugins
  // Installation order is composition order: help and version answer before any later plugin.
  plugins: [
    help(),
    suggestions(),
    version(),
    format(),
    manifest(),
    config(),
    completion(),
    mcp(),
    raceHint(),
  ],
  // #endregion
  translators: [splitTooLong],
  views: [override(InternalError, defectView)],
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

export const pace = configured.command(calc).command(splits).command(convert).command(races);
