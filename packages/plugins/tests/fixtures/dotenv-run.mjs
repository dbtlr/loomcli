import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { Application, processHandle } from '@loomcli/core';
import { dotenv } from '@loomcli/plugins/dotenv';

const [mode] = process.argv.slice(2);
// Create the unreadable path after Bun's own startup dotenv read, so the plugin sees the failure.
const unreadable = process.env.FIXTURE_UNREADABLE;
if (unreadable !== undefined) {
  symlinkSync(unreadable, join(process.cwd(), unreadable));
}
const settings = JSON.parse(process.env.FIXTURE_SETTINGS ?? 'null') ?? undefined;
const observedNames = JSON.parse(process.env.FIXTURE_NAMES ?? '["TOKEN"]');
// Bun reads the dotenv files before this fixture starts, so 'native' reports the values it read.
if (mode === 'native') {
  const native = Object.fromEntries(observedNames.map((name) => [name, process.env[name]]));
  process.stdout.write(JSON.stringify(native));
  process.exit(0);
}
// Bun reads .env before this fixture starts; each test needs a controlled process baseline.
for (const name of new Set([...observedNames, 'TOKEN', 'ALT', 'ENABLED'])) {
  delete process.env[name];
}
const installed = dotenv(settings);
const hostOverride = { cwd: process.cwd(), env: JSON.parse(process.env.FIXTURE_ENV ?? '{}') };
const app = new Application('app', {
  description: 'Read a dotenv file.',
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
    const processEnv = Object.fromEntries(observedNames.map((name) => [name, process.env[name]]));
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
  const outcome = await app.invoke([], {}, { process: processHandle(hostOverride) });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
} else if (mode === 'process') {
  await app.run({ process: processHandle({ argv: [] }) });
} else if (mode !== 'settings') {
  await app.run({
    process: processHandle({ ...hostOverride, argv: [] }),
  });
}
