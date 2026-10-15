import { Application } from '@loomcli/core';

import { confirm, secret, select, text } from '../../dist/index.js';

const scenario = process.argv[2];
const cases = {
  'choice-default': (context) => select(context, { choices: ['a'], default: 'b', message: 'Mode' }),
  'confirm-default': (context) => confirm(context, { default: 'yes', message: 'Continue?' }),
  'confirm-string': (context) => confirm(context, { message: 'Continue?', option: 'name' }),
  content: (context) => text(context, { message: 'File', option: 'file' }),
  count: (context) => text(context, { message: 'Level', option: 'level' }),
  empty: (context) => select(context, { choices: [], message: 'Mode' }),
  global: (context) => text(context, { message: 'Name', option: 'global' }),
  multiple: (context) => text(context, { message: 'Tags', option: 'tags' }),
  repeated: (context) => select(context, { choices: ['a', 'a'], message: 'Mode' }),
  'secret-default': (context) => secret(context, { default: 'bad', message: 'Secret' }),
  'skip-unlinked': (context) => text(context, { message: 'Name', skipIfSupplied: true }),
  'text-default': (context) => text(context, { default: 42, message: 'Name' }),
  unknown: (context) => text(context, { message: 'Name', option: 'unknown' }),
  validator: (context) => text(context, { message: 'Name', validate: {} }),
};
const app = new Application('faults', { description: 'Exercise malformed questions.' })
  .globalOption('global', { description: 'Global value.', type: 'string' })
  .option('name', { description: 'Name.', type: 'string' })
  .option('tags', { description: 'Tags.', multiple: true, type: 'string' })
  .option('level', { description: 'Level.', type: 'count' })
  .option('file', { description: 'File.', type: 'content' })
  .action(async (context) => {
    try {
      await cases[scenario](context);
      await context.out.print('accepted');
    } catch (error) {
      await context.out.print(JSON.stringify({ name: error.name, rule: error.rule?.identity }));
    }
  });
process.exitCode = await app.run({ host: { argv: [] } });
