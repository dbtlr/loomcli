import { processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { recordLoads } from '../../../../scripts/record-loads.mjs';
import { fixtureApplication } from './run-app.ts';

await recordLoads();
const [name, ...argv] = process.argv.slice(2);
process.exitCode = await fixtureApplication(name).run({
  process: processHandle({ argv, home: fixtureHome(), release: { build: 'distributed' } }),
});
