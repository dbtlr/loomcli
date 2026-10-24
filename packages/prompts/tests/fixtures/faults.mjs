import { Application, processHandle } from '@loomcli/core';

import { confirm, select, text } from '../../dist/index.js';

const scenario = process.argv[2];
const cases = {
  'confirm-string': (context) => confirm(context, { message: 'Continue?', option: 'name' }),
  content: (context) => text(context, { message: 'File', option: 'file' }),
  count: (context) => text(context, { message: 'Level', option: 'level' }),
  empty: (context) => select(context, { choices: [], message: 'Mode' }),
  global: (context) => text(context, { message: 'Name', option: 'global' }),
  multiple: (context) => text(context, { message: 'Tags', option: 'tags' }),
  unknown: (context) => text(context, { message: 'Name', option: 'unknown' }),
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
      await context.out.print(
        JSON.stringify({
          correction: error.correction,
          name: error.name,
          rule: error.rule?.identity,
          sentence: error.sentence,
        }),
      );
    }
  });
process.exitCode = await app.run({ process: processHandle({ argv: [] }) });
