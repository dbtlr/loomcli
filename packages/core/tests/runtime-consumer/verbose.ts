import { Application, processHandle } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';
import { verbose } from '@loomcli/plugins/verbose';
import type { VerboseOptions } from '@loomcli/plugins/verbose';

// The packed verbose plugin gives the operator -v and -q, which core reads after graph build.
const installed: Plugin<VerboseOptions> = verbose();

const app = new Application('packed-verbose', { plugins: [installed] }).action(async ({ out }) => {
  await out.debug('debug');
  await out.trace('trace');
  await out.info('info');
});

await app.run({
  process: processHandle({ argv: process.argv.slice(2), env: {} }),
});
