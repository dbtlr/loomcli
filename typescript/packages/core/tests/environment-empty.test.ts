/*
 * Acceptance plan for a string binding that lets a defined empty variable supply the option
 * (docs/core/input-sources.md#input-sources, Empty values).
 *
 * Every case runs an Application in process on a mock process.
 *
 * - Default. Without `envAllowEmpty`, and with it `false`, an empty variable is unset and falls
 *   through to the default.
 * - Opt in. With `envAllowEmpty: true`, `APP_PREFIX=` fills the empty string and the default does
 *   not apply, and a non-empty value fills as before.
 * - Lists. The first name the environment defines supplies the option, so a defined empty name
 *   stops the search, and an undefined name is skipped.
 * - Configuration. Under the key `APP_PREFIX=` clears a prefix the configuration source holds, and
 *   the source is never asked for the option. Without the key the source supplies it.
 * - Ordinary fill. The empty string satisfies `required`, never fills the implied value, passes
 *   through the option's validator, and loses to argv.
 * - Projections. `inspect()` publishes the key on the string variant alone.
 */
import { Application, extension, plugin } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/** The prefixes the action read, or none when it never ran. */
const seen: (string | undefined)[] = [];

/** One run of an application whose `prefix` option binds the given names under the given key. */
async function prefixOf(
  binding: { envAllowEmpty?: boolean },
  env: Record<string, string>,
  argv: string[] = [],
) {
  seen.length = 0;
  const mock = mockProcess({ argv, env });
  const status = await new Application('app')
    .option('prefix', {
      default: 'fallback',
      env: ['APP_PREFIX', 'LEGACY_PREFIX'],
      type: 'string',
      ...binding,
    })
    .action(({ options }) => {
      seen.push(options.prefix);
    })
    .run({ process: mock });
  return { seen: [...seen], status, stderr: mock.stderr.text };
}

test('an empty variable is unset without the key and with the key false', async () => {
  await expect(prefixOf({}, { APP_PREFIX: '' })).resolves.toMatchObject({ seen: ['fallback'] });
  await expect(prefixOf({ envAllowEmpty: false }, { APP_PREFIX: '' })).resolves.toMatchObject({
    seen: ['fallback'],
  });
});

test('under the key a defined empty variable fills the empty string and the default does not apply', async () => {
  await expect(prefixOf({ envAllowEmpty: true }, { APP_PREFIX: '' })).resolves.toMatchObject({
    seen: [''],
    status: 0,
  });
  await expect(prefixOf({ envAllowEmpty: true }, { APP_PREFIX: 'x' })).resolves.toMatchObject({
    seen: ['x'],
  });
  await expect(prefixOf({ envAllowEmpty: true }, {})).resolves.toMatchObject({
    seen: ['fallback'],
  });
});

test('under the key the first defined name supplies the option and an undefined name is skipped', async () => {
  const allow = { envAllowEmpty: true };
  await expect(prefixOf(allow, { APP_PREFIX: '', LEGACY_PREFIX: 'old' })).resolves.toMatchObject({
    seen: [''],
  });
  await expect(prefixOf(allow, { LEGACY_PREFIX: '' })).resolves.toMatchObject({ seen: [''] });
  await expect(prefixOf(allow, { LEGACY_PREFIX: 'old' })).resolves.toMatchObject({
    seen: ['old'],
  });
  // Without the key the empty first name falls through to the later name.
  await expect(prefixOf({}, { APP_PREFIX: '', LEGACY_PREFIX: 'old' })).resolves.toMatchObject({
    seen: ['old'],
  });
});

const configKey = extension('@fixture/config/key', { schema: z.string(), target: 'option' });

/** The option names each call of the configuration source was asked for. */
const asked: string[][] = [];

/** A configuration source that holds `configured` for every option it is asked for. */
const configuration = () =>
  plugin('@fixture/config', {
    extensions: [configKey],
    source: {
      binding: configKey,
      load: () =>
        Promise.resolve({
          default: async ({ requests }) => {
            asked.push(requests.map(({ name }) => name));
            return Object.fromEntries(
              requests.map(({ name }) => [
                name,
                { label: 'the fixture settings', value: 'configured' },
              ]),
            );
          },
        }),
    },
  });

/** One run of an application whose `prefix` option binds a variable and a configuration key. */
async function configuredPrefixOf(
  binding: { envAllowEmpty?: boolean },
  env: Record<string, string>,
) {
  asked.length = 0;
  const values: unknown[] = [];
  const status = await new Application('app', { plugins: [configuration()] })
    .option('prefix', {
      env: 'APP_PREFIX',
      extensions: [configKey('prefix')],
      type: 'string',
      ...binding,
    })
    .action(({ options }) => {
      values.push(options.prefix);
    })
    .run({ process: mockProcess({ argv: [], env }) });
  return { asked: asked.flat(), status, values };
}

test('under the key a defined empty variable clears a configured value and the source is never asked', async () => {
  await expect(configuredPrefixOf({ envAllowEmpty: true }, { APP_PREFIX: '' })).resolves.toEqual({
    asked: [],
    status: 0,
    values: [''],
  });
  await expect(configuredPrefixOf({}, { APP_PREFIX: '' })).resolves.toEqual({
    asked: ['prefix'],
    status: 0,
    values: ['configured'],
  });
});

test('argv outranks a defined empty variable', async () => {
  await expect(
    prefixOf({ envAllowEmpty: true }, { APP_PREFIX: '' }, ['--prefix', 'cli']),
  ).resolves.toMatchObject({ seen: ['cli'] });
});

test('the empty string satisfies required and never fills the implied value', async () => {
  const mock = mockProcess({ argv: [], env: { APP_NEEDED: '' } });
  const values: unknown[] = [];
  const status = await new Application('app')
    .option('needed', {
      env: 'APP_NEEDED',
      envAllowEmpty: true,
      implied: 'implied',
      required: true,
      type: 'string',
    })
    .action(({ options }) => {
      values.push(options.needed);
    })
    .run({ process: mock });
  expect({ status, values }).toEqual({ status: 0, values: [''] });
});

test('a validator that rejects the empty string fails naming the variable', async () => {
  const mock = mockProcess({ argv: [], env: { APP_PREFIX: '' } });
  const status = await new Application('app')
    .option('prefix', {
      env: 'APP_PREFIX',
      envAllowEmpty: true,
      type: 'string',
      validate: z.string().min(1, 'Supply a prefix.'),
    })
    .action(() => {})
    .run({ process: mock });
  expect(status).toBe(2);
  expect(mock.stderr.text).toBe('app: Option "--prefix" (from APP_PREFIX): Supply a prefix.\n');
});

test('inspect publishes the key on a string option and false when it is not declared', () => {
  const graph = new Application('app')
    .option('prefix', { env: 'APP_PREFIX', envAllowEmpty: true, type: 'string' })
    .option('plain', { env: 'APP_PLAIN', type: 'string' })
    .option('path', { type: 'content' })
    .action(() => {})
    .inspect();
  const byName = new Map(graph.root.options.map((option) => [option.name, option]));
  expect(byName.get('prefix')).toMatchObject({ envAllowEmpty: true });
  expect(byName.get('plain')).toMatchObject({ envAllowEmpty: false });
  expect(byName.get('path')).not.toHaveProperty('envAllowEmpty');
});
