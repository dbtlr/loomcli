import { Application, Command } from '@loomcli/core';

import { declare } from './declare.mjs';

const base = new Application('example').globalOption('quiet', { type: 'boolean' });
const action = ({ options, out }) => out.print(JSON.stringify(options));
const scenario = process.argv[2];
const scenarios = {
  'after-action': () => base.action(action).globalOption('late', { type: 'boolean' }),
  'after-command': () =>
    base.command(new Command('read').action(action)).globalOption('late', { type: 'boolean' }),
  derived: () => base.globalOption('limit', { default: '10', type: 'string' }).action(action),
  'local-first': () =>
    new Application('example')
      .option('quiet', { type: 'boolean' })
      .globalOption('quiet', { type: 'boolean' })
      .action(action),
  original: () => base.action(action),
};
const app = declare(scenarios[scenario]);
process.exitCode = await app.run({ host: { argv: [] } });
