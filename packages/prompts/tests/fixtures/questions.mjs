import { Application, processHandle } from '@loomcli/core';

import { confirm, text } from '../../dist/index.js';

const scenario = process.argv[2];
const app = new Application('setup', { description: 'Set up the service.' })
  .option('port', {
    description: 'Service port.',
    type: 'string',
    validate: {
      '~standard': {
        validate: (value) => ({ value: Number(value) }),
        vendor: 'fixture',
        version: 1,
      },
    },
  })
  .option('install', { description: 'Install the service.', type: 'boolean' })
  .action(async (context) => {
    if (scenario === 'named-boolean-missing') {
      await confirm(context, { message: 'Install service?', option: 'install' });
      return;
    }
    if (scenario === 'unlinked' || scenario === 'named-unlinked') {
      await text(context, { message: 'Name' });
      return;
    }
    const value = await text(context, {
      message: 'Service port',
      option: 'port',
      validate: {
        '~standard': {
          validate: () => {
            throw new Error('Question validation must not run.');
          },
          vendor: 'fixture',
          version: 1,
        },
      },
    });
    await context.out.print(JSON.stringify(value));
  });
if (scenario.startsWith('named-')) {
  const outcome = await app.invoke([], {
    options: scenario === 'named-linked' ? { port: '8080' } : {},
  });
  process.stdout.write(JSON.stringify(outcome));
} else {
  process.exitCode = await app.run({ process: processHandle({ argv: process.argv.slice(3) }) });
}
