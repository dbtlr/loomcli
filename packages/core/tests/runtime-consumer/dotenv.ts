import { Application } from '@loomcli/core';
import { dotenv } from '@loomcli/plugins/dotenv';
import type { DotenvSettings } from '@loomcli/plugins/dotenv';

const settings: DotenvSettings = { only: ['LOOM_PACKED_DOTENV_TOKEN'] };
// Bun loads .env before the entry runs; isolate the plugin's own publication from that bootstrap.
delete process.env.LOOM_PACKED_DOTENV_TOKEN;
const app = new Application('dotenv', {
  description: 'Prepare dotenv values.',
  plugins: [dotenv(settings)],
})
  .option('token', {
    description: 'An imported token.',
    env: 'LOOM_PACKED_DOTENV_TOKEN',
    type: 'string',
  })
  .action(({ host, options, out }) =>
    out.print(
      JSON.stringify({
        env: host.env.LOOM_PACKED_DOTENV_TOKEN,
        process: process.env.LOOM_PACKED_DOTENV_TOKEN ?? null,
        value: options.token,
      }),
    ),
  );

const named = await app.invoke([], {}, { host: { cwd: process.cwd(), env: {} } });
process.stdout.write(`${JSON.stringify(named)}\n`);
await app.run({ host: { argv: [] } });
