import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { Application } from '@loomcli/core';
import { dotenv } from '@loomcli/plugins/dotenv';

const [mode] = process.argv.slice(2);
// Create the unreadable path after Bun's own startup dotenv read, so the plugin sees the failure.
if (process.env.FIXTURE_UNREADABLE === '1') {
  symlinkSync('.env', join(process.cwd(), '.env'));
}
const variables =
  mode === 'copy' ? ['TOKEN'] : JSON.parse(process.env.FIXTURE_VARIABLES ?? '["TOKEN"]');
// Bun reads .env before this fixture starts; each test needs a controlled process baseline.
for (const name of new Set([...variables, 'TOKEN', 'ALT', 'ENABLED', 'UNLISTED'])) {
  delete process.env[name];
}
const installed =
  mode === 'settings'
    ? dotenv(
        process.env.FIXTURE_SETTINGS === undefined
          ? undefined
          : JSON.parse(process.env.FIXTURE_SETTINGS),
      )
    : dotenv({ variables });
if (mode === 'copy') {
  variables.splice(0, variables.length, 'NEXT');
}
const observedNames = [...new Set([...variables, 'TOKEN', 'UNLISTED'])];
const hostOverride = { cwd: process.cwd(), env: JSON.parse(process.env.FIXTURE_ENV ?? '{}') };
const app = new Application('app', {
  description: 'Read an allowlisted dotenv file.',
  plugins: [installed],
})
  .option('token', {
    default: 'fallback',
    description: 'The token.',
    env: ['TOKEN', 'ALT'],
    type: 'string',
  })
  .option('enabled', { description: 'Enable the feature.', env: 'ENABLED', type: 'boolean' })
  .action(({ host, options, out, style }) => {
    if (mode === 'color') {
      return out.print(style.bold('colored'));
    }
    const env = Object.fromEntries(
      observedNames.flatMap((name) =>
        host.env[name] === undefined ? [] : [[name, host.env[name]]],
      ),
    );
    const processEnv = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
    return out.print(
      JSON.stringify({
        env,
        options,
        process: process.env.TOKEN ?? null,
        ...(mode === 'process'
          ? {
              child: spawnSync(
                process.execPath,
                ['-e', 'process.stdout.write(process.env.TOKEN ?? "")'],
                { encoding: 'utf8' },
              ).stdout,
              processEnv,
            }
          : {}),
      }),
    );
  });

if (mode === 'invoke') {
  const outcome = await app.invoke([], {}, { host: hostOverride });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
} else if (mode === 'process') {
  await app.run({ host: { argv: [] } });
} else if (mode !== 'settings') {
  await app.run({
    host: { ...hostOverride, argv: [] },
  });
}
