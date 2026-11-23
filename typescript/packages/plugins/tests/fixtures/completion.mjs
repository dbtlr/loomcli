import { processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { completionApplication } from './completion-app.ts';

process.exitCode = await completionApplication().run({
  process: processHandle({ home: fixtureHome() }),
});
