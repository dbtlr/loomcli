/*
 * Acceptance plan for the options an invocation by name excludes
 * (docs/core/invocation.md#invocation-by-name, docs/core/input-sources.md#input-sources).
 *
 * Every case runs an Application in process on a mock process. A fixture plugin declares a global
 * `region` option bound to a variable and to a configuration key, and a configuration source that
 * answers every key it holds, so a call that reads any source for an option shows it.
 *
 * - Sources. An excluded option with its variable set and a configuration answer available reads
 *   its declared default, and the source is never asked for it. The same option without `exclude`
 *   reads the variable, and a call that excludes nothing asks the source. This holds for a local
 *   option and a global option, and for the source's own option, which reads no variable.
 * - Unknown names. A key of `options` that names an excluded option, and a name in `exclude` that
 *   the table does not hold, report the by-name unknown-option sentence with exit 2, and the first
 *   held fault follows the order `options` keys, `exclude` names, `args` keys.
 * - Required. An excluded required option reports the missing-input problem by name.
 * - Scope. The exclusion lasts for the one call: a nested call excludes only what it names.
 */
import { Application, Command, extension, plugin } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

const configKey = extension('@fixture/config/key', { schema: z.string(), target: 'option' });

/** What the source was asked, and the answers it holds, keyed by the binding value. */
const asked: string[][] = [];

/** What one call of the application resolves. */
type Outcome = Awaited<ReturnType<ReturnType<typeof application>['invoke']>>;
const answers: Record<string, string> = { 'app.mode': 'from-config', 'app.region': 'from-config' };

const config = () =>
  plugin('@fixture/config', {
    extensions: [configKey],
    options: {
      region: {
        default: 'default-region',
        description: 'The region.',
        env: 'FIXTURE_REGION',
        extensions: [configKey('app.region')],
        type: 'string',
      },
      settings: {
        default: 'default.json',
        description: 'The settings file.',
        env: 'FIXTURE_SETTINGS',
        type: 'string',
      },
    },
    source: {
      binding: configKey,
      load: () =>
        Promise.resolve({
          default: async ({ requests }) => {
            asked.push(requests.map(({ name }) => name));
            return Object.fromEntries(
              requests.flatMap(({ name }) => {
                const answer = answers[`app.${name}`];
                return answer === undefined
                  ? []
                  : [[name, { label: 'the fixture settings', value: answer }]];
              }),
            );
          },
        }),
    },
  });

/** The values the `show` action read, as the call's output. */
function application() {
  const show = new Command('show', { description: 'Show the values read.' })
    .option('mode', {
      default: 'default-mode',
      description: 'The mode.',
      env: 'FIXTURE_MODE',
      extensions: [configKey('app.mode')],
      type: 'string',
    })
    .option('need', { description: 'A required value.', required: true, type: 'string' })
    .argument('target', { description: 'The target.' })
    .action(async ({ options, out }) => {
      await out.print(JSON.stringify(options));
    });
  const nest = new Command('nest', { description: 'Call show with an exclusion.' }).action(
    async ({ invoke, out }) => {
      const inner = await invoke(
        ['show'],
        { options: { need: 'x' } },
        { exclude: ['mode', 'region'] },
      );
      const outer = await invoke(['show'], { options: { need: 'x' } });
      await out.print(
        JSON.stringify(
          [inner, outer].map((each) => (each.status === 'completed' ? each.output : each.status)),
        ),
      );
    },
  );
  return new Application('app', { description: 'An app.', plugins: [config()] })
    .command(show)
    .command(nest);
}

/** One call of the application, on a process whose environment holds every bound variable. */
function call(
  path: string[],
  values: Parameters<ReturnType<typeof application>['invoke']>[1],
  options: Parameters<ReturnType<typeof application>['invoke']>[2] = {},
): Promise<Outcome> {
  asked.length = 0;
  const env = {
    FIXTURE_MODE: 'from-env',
    FIXTURE_REGION: 'from-env',
    FIXTURE_SETTINGS: 'env.json',
  };
  return application().invoke(path, values, { ...options, process: mockProcess({ env }) });
}

/** The options record a completed call's action printed. */
function printed(outcome: Outcome): Record<string, unknown> {
  if (outcome.status !== 'completed') {
    throw new Error(`The call ${outcome.status}.`);
  }
  return JSON.parse(outcome.output);
}

const need = { options: { need: 'x' } };

test('an excluded local option reads its default although its variable and configuration key hold values', async () => {
  const excluded = printed(await call(['show'], need, { exclude: ['mode'] }));
  expect(excluded.mode).toBe('default-mode');
  expect(printed(await call(['show'], need)).mode).toBe('from-env');
});

test('an excluded global option reads its default and the source is never asked for it', async () => {
  expect(printed(await call(['show'], need, { exclude: ['region'] })).region).toBe(
    'default-region',
  );
  expect(asked.flat()).not.toContain('region');
  expect(printed(await call(['show'], need)).region).toBe('from-env');
});

test('an excluded option falls to its default although only the configuration holds a value', async () => {
  const outcome = await application().invoke(['show'], need, {
    exclude: ['mode'],
    process: mockProcess({ env: {} }),
  });
  expect(printed(outcome).mode).toBe('default-mode');
  const plain = await application().invoke(['show'], need, { process: mockProcess({ env: {} }) });
  expect(printed(plain).mode).toBe('from-config');
});

test('an excluded source option reads no variable, so it keeps its declared default', async () => {
  expect(printed(await call(['show'], need)).settings).toBe('env.json');
  expect(printed(await call(['show'], need, { exclude: ['settings'] })).settings).toBe(
    'default.json',
  );
});

test('a key of options that names an excluded option is the unknown option, by name', async () => {
  const outcome = await call(
    ['show'],
    { options: { mode: 'x', need: 'x' } },
    { exclude: ['mode'] },
  );
  expect(outcome).toMatchObject({
    exitCode: 2,
    failure: { name: 'UnknownOptionError', spelling: 'mode' },
    messages: 'app: Unknown option "mode". Supply the name of a declared option.\n',
    status: 'failed',
  });
});

test('an exclude name the table does not hold is the unknown option, by name', async () => {
  const outcome = await call(['show'], need, { exclude: ['nope'] });
  expect(outcome).toMatchObject({
    exitCode: 2,
    failure: { name: 'UnknownOptionError', spelling: 'nope' },
    messages: 'app: Unknown option "nope". Supply the name of a declared option.\n',
    status: 'failed',
  });
});

test('the first held fault follows options keys, then exclude names, then args keys', async () => {
  const both = await call(['show'], { options: { bad: 1 } }, { exclude: ['nope'] });
  expect(both).toMatchObject({ failure: { spelling: 'bad' }, status: 'failed' });
  const excludeFirst = await call(
    ['show'],
    { args: { stray: 'x' }, options: { need: 'x' } },
    { exclude: ['nope'] },
  );
  expect(excludeFirst).toMatchObject({ failure: { spelling: 'nope' }, status: 'failed' });
  const argsLast = await call(['show'], { args: { stray: 'x' }, options: { need: 'x' } });
  expect(argsLast).toMatchObject({
    failure: { name: 'UnexpectedArgumentError' },
    status: 'failed',
  });
});

test('an excluded required option reports the missing-input problem by name', async () => {
  const outcome = await call(['show'], {}, { exclude: ['need'] });
  expect(outcome).toMatchObject({
    exitCode: 2,
    failure: { problems: [{ reason: 'missing', spelling: 'need' }] },
    status: 'failed',
  });
});

test('a nested call excludes only what its own exclude names', async () => {
  const outcome = await call(['nest'], {}, { exclude: ['region'] });
  if (outcome.status !== 'completed') {
    throw new Error(`The call ${outcome.status}.`);
  }
  const [inner, outer]: string[] = JSON.parse(outcome.output);
  expect(JSON.parse(inner ?? '')).toMatchObject({ mode: 'default-mode', region: 'default-region' });
  expect(JSON.parse(outer ?? '')).toMatchObject({ mode: 'from-env', region: 'from-env' });
});
