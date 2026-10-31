import { processHandle, plugin } from '@loomcli/core';

import { typeErrorApplication, brokenStdoutApplication, fullDisk, deepFrozen } from './logging.mjs';

const [scenario, ...argv] = process.argv.slice(2);
if (!['type-error', 'stdout-broken'].includes(scenario)) {
  throw new Error(`Unknown scenario: ${scenario}`);
}
const collected = [];
const collector = plugin('fixture/collector', {
  onLog: (event) => collected.push({ event, frozen: deepFrozen(event) }),
});
const code = await (
  scenario === 'type-error'
    ? typeErrorApplication([collector])
    : brokenStdoutApplication([collector])
).run({
  process: processHandle({
    argv,
    ...(scenario === 'stdout-broken' ? { stdout: fullDisk() } : {}),
    ...(process.env.FIXTURE_BUILD === undefined
      ? {}
      : { release: { build: process.env.FIXTURE_BUILD } }),
  }),
});
for (const entry of collected) {
  process.stdout.write(`event:${JSON.stringify(entry)}\n`);
}
process.stdout.write(`resolved:${code}\n`);
