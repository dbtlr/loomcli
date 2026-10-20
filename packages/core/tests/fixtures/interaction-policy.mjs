import { interaction } from '@loomcli/plugins/interaction';

import { Application } from '../../dist/index.js';

const scenario = process.argv[2];
try {
  if (scenario === 'twice') {
    new Application('setup')
      .globalOption('input', { interaction: true, type: 'boolean' })
      .globalOption('other', { interaction: true, type: 'boolean' });
  } else {
    const app = new Application('setup', {
      description: 'Configure the service.',
      plugins: [interaction({ env: 'SETUP_INPUT' })],
    })
      .option('port', { description: 'Service port.', required: 'non-interactive', type: 'string' })
      .action(async (context) => {
        if (scenario === 'cancel') {
          context.cancel();
          throw context.signal.reason;
        }
        await context.out.print(JSON.stringify({ interactive: context.interactive }));
      });
    if (scenario === 'invoke') {
      const outcome = await app.invoke([], { options: { port: '8080' } });
      process.stdout.write(outcome.output);
    } else {
      process.exitCode = await app.run({
        host: {
          argv:
            { disabled: ['--no-input', '--port', '8080'], env: ['--port', '8080'] }[scenario] ?? [],
          env: scenario === 'env' ? { SETUP_INPUT: 'false' } : {},
          terminal: {
            stderr: { columns: 80, isTTY: true, rows: 24 },
            stdin: { isTTY: true },
            stdout: { columns: undefined, isTTY: false, rows: undefined },
          },
        },
      });
    }
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ message: error.message, name: error.name }));
}
