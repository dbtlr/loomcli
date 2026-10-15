import { Application } from '@loomcli/core';

import { text } from '../../dist/index.js';

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
  .action(async (context) => {
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
  process.exitCode = await app.run({ host: { argv: process.argv.slice(3) } });
}
