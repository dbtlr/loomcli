import { Application } from '../../dist/index.js';

const app = new Application('setup', { description: 'Configure the service.' })
  .option('port', {
    description: 'Service port.',
    required: 'non-interactive',
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
    await context.out.print(
      JSON.stringify({
        interactive: context.interactive,
        port: context.options.port,
        raw: context.supplied.options.port,
      }),
    );
  });

process.exitCode = await app.run();
