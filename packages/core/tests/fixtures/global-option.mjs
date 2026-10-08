import { Application, Command } from '@loomcli/core';

import { declare } from './declare.mjs';

const base = new Application('example').globalOption('quiet', { type: 'boolean' });
const action = ({ options, out }) => out.print(JSON.stringify(options));
const scenario = process.argv[2];
const scenarios = {
  'after-action': () => base.action(action).globalOption('late', { type: 'boolean' }),
  'after-command': () =>
    base.command(new Command('read').action(action)).globalOption('late', { type: 'boolean' }),
  // The default reads as a string until the call has captured its config, then as a number.
  // Validation of the raw config would then reject the declaration the stored copy satisfies.
  'default-captured': () => {
    let reads = 0;
    const config = { type: 'string' };
    Object.defineProperty(config, 'default', {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads <= 2 ? 'kept' : 7;
      },
    });
    return new Application('example').globalOption('limit', config).action(action);
  },
  derived: () => base.globalOption('limit', { default: '10', type: 'string' }).action(action),
  'local-first': () =>
    new Application('example')
      .option('quiet', { type: 'boolean' })
      .globalOption('quiet', { type: 'boolean' })
      .action(action),
  original: () => base.action(action),
  required: () => base.globalOption('file', { required: true, type: 'string' }).action(action),
  'required-false': () =>
    base.globalOption('file', { required: false, type: 'string' }).action(action),
  'validate-omitted': () =>
    base
      .globalOption('file', {
        type: 'string',
        validate: { '~standard': { validate: (value) => ({ value }), vendor: 'test', version: 1 } },
        validateOmitted: true,
      })
      .action(action),
};
const app = declare(scenarios[scenario]);
process.exitCode = await app.run({ host: { argv: [], release: { build: 'distributed' } } });
