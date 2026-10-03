import { Application, plugin } from '@loomcli/core';
import { integer, oneOf } from '@loomcli/validators';

import { configKey } from './extension.mjs';

/**
 * A configuration plugin whose own option takes a validator, and an application whose global
 * options are validated too, so a test reads every rejected value in one report.
 */
const profiles = plugin('@fixture/profiles', {
  extensions: [configKey],
  options: { profile: { type: 'string', validate: oneOf(['dev', 'prod']) } },
  source: { binding: configKey, load: () => import('./source.mjs') },
});

const app = new Application('app', { plugins: [profiles] })
  .globalOption('size', { type: 'string', validate: integer() })
  .globalOption('name', { extensions: [configKey('name')], type: 'string' })
  .action(({ options, out }) => out.print(`root:${JSON.stringify(options)}`));

const code = await app.run({ host: { argv: process.argv.slice(2) } });
process.stdout.write(`resolved:${code}\n`);
