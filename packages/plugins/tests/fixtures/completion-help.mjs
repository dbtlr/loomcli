import { processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { completionHelpApplication } from './completion-help-app.ts';

process.exitCode = await completionHelpApplication().run({
  process: processHandle({ home: fixtureHome() }),
});
