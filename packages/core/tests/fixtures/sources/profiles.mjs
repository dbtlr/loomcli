import { Application, Command, plugin } from '@loomcli/core';
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

// `name` is required and bound to the source, and `title` is required and bound to nothing.
const named = new Command('x')
  .option('name', { extensions: [configKey('name')], required: true, type: 'string' })
  .option('title', { required: true, type: 'string' })
  .action(({ options, out }) => out.print(`x:${JSON.stringify(options)}`));

const app = new Application('app', { plugins: [profiles] })
  .globalOption('size', { type: 'string', validate: integer() })
  .globalOption('owner', { extensions: [configKey('owner')], type: 'string' })
  .command(named)
  .action(({ options, out }) => out.print(`root:${JSON.stringify(options)}`));

const code = await app.run({ host: { argv: process.argv.slice(2) } });
process.stdout.write(`resolved:${code}\n`);
