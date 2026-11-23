import { processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { application } from './option-groups-app.ts';

process.exitCode = await application().run({ process: processHandle({ home: fixtureHome() }) });
