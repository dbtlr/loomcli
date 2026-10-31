import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { Application } from '@loomcli/core';
import { dotenv } from '@loomcli/plugins/dotenv';
import { mockProcess } from '@loomcli/testing';
import { z } from 'zod';

import { runOnMock } from './in-process.ts';

const settingsSchema = z.union([
  z.object({ only: z.array(z.string()) }),
  z.object({ except: z.array(z.string()) }),
  z.null(),
]);

/** Parser cases and publication cases share the same application and observe real handle effects. */
function dotenvApplication(
  mode: string,
  names: readonly string[],
  settings: Parameters<typeof dotenv>[0],
  published: ReadonlyMap<string, string>,
) {
  return new Application('app', { description: 'Read a dotenv file.', plugins: [dotenv(settings)] })
    .option('token', {
      default: 'fallback',
      description: 'The token.',
      env: ['TOKEN', 'ALT'],
      type: 'string',
    })
    .option('prefix', {
      default: 'fallback',
      description: 'The prefix.',
      env: 'PREFIX',
      envAllowEmpty: true,
      type: 'string',
    })
    .option('enabled', { description: 'Enable the feature.', env: 'ENABLED', type: 'boolean' })
    .action(async ({ host, options, out, style }) => {
      if (mode === 'color') {
        return await out.print(style.bold('colored'));
      }
      const env = Object.fromEntries(
        names.flatMap((name) => (host.env[name] === undefined ? [] : [[name, host.env[name]]])),
      );
      let child: string | undefined = undefined;
      if (mode === 'process') {
        const exit = await host.spawn('environment-child', [], {}).exited;
        if (exit.kind === 'unstarted') {
          throw exit.error;
        }
        child = exit.stdout.text;
      }
      return await out.print(
        JSON.stringify({
          env,
          options,
          process: published.get('TOKEN') ?? null,
          ...(mode === 'process'
            ? {
                child,
                processEnv: Object.fromEntries(names.map((name) => [name, published.get(name)])),
              }
            : {}),
        }),
      );
    });
}

async function run(args: string[], fixtureEnv: Record<string, string | undefined>, cwd: string) {
  const mode = args[0] ?? 'run';
  const unreadable = fixtureEnv.FIXTURE_UNREADABLE;
  if (unreadable !== undefined) {
    symlinkSync(unreadable, join(cwd, unreadable));
  }
  const settings =
    settingsSchema.parse(JSON.parse(fixtureEnv.FIXTURE_SETTINGS ?? 'null')) ?? undefined;
  const names = z.array(z.string()).parse(JSON.parse(fixtureEnv.FIXTURE_NAMES ?? '["TOKEN"]'));
  const env = z
    .record(z.string(), z.string().optional())
    .parse(JSON.parse(fixtureEnv.FIXTURE_ENV ?? '{}'));
  for (const name of z.array(z.string()).parse(JSON.parse(fixtureEnv.FIXTURE_UNSET ?? '[]'))) {
    env[name] = undefined;
  }
  const published = new Map<string, string>();
  const app = dotenvApplication(mode, names, settings, published);
  if (mode === 'invoke') {
    const mock = mockProcess({ cwd, env });
    const outcome = await app.invoke([], {}, { process: mock });
    mock.stdout.write(`${JSON.stringify(outcome)}\n`);
    return { status: mock.exitCode, stderr: mock.stderr.text, stdout: mock.stdout.text };
  }
  return await runOnMock(
    app,
    {
      argv: [],
      cwd,
      env,
      programs: { 'environment-child': (call) => ({ stdout: call.env.TOKEN ?? '' }) },
    },
    mode === 'process'
      ? {
          publishEnv: (name, value) => {
            published.set(name, value);
          },
        }
      : {},
  );
}

export { run };
