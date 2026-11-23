import { processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { completionDynamicApplication } from './completion-dynamic-app.ts';

process.exitCode = await completionDynamicApplication().run({
  process: processHandle({ home: fixtureHome() }),
});
