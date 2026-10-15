import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { interaction } from '@loomcli/plugins/interaction';
import { manifest } from '@loomcli/plugins/manifest';

const app = new Application('setup', {
  description: 'Configure the service.',
  plugins: [help(), interaction(), manifest()],
})
  .option('port', { description: 'Service port.', required: 'non-interactive', type: 'string' })
  .action(() => {});
if (process.argv[2] === 'inspect') {
  process.stdout.write(JSON.stringify(app.inspect()));
} else {
  process.exitCode = await app.run({ host: { argv: [process.argv[2]] } });
}
