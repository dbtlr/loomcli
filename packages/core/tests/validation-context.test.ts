import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

/** The fixture encodes a declared `undefined` as this marker, which JSON alone cannot carry. */
const none = '#undefined';

/** The fixture overrides the captured cwd, so the echoed host is the one the action receives. */
const cwd = '/loom/context';

async function context(scenario: string, argv: string[] = []) {
  const result = await invokeFixture(new URL('fixtures/validation-context.mjs', import.meta.url), [
    scenario,
    ...argv,
  ]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test('every invocation validator call reads the routed path, passthrough, and supplied tokens', async () => {
  const argv = [
    '--mode',
    'fast',
    'one',
    'two',
    'three',
    '--single',
    's',
    '--multi',
    'a',
    '--multi',
    'b',
    '--flag',
    '--no-color',
    '--',
    'tail',
  ];
  const shared = {
    command: [],
    host: { argv, cwd },
    passthrough: ['tail'],
    phase: 'invocation',
    supplied: {
      args: { files: ['two', 'three'], name: 'one' },
      options: {
        absent: none,
        color: false,
        flag: true,
        mode: 'fast',
        multi: ['a', 'b'],
        pending: [],
        quiet: none,
        single: 's',
      },
    },
    suppliedKey: true,
  };
  await expect(context('root', argv)).resolves.toEqual({
    records: [
      {
        context: { ...shared, input: { global: true, kind: 'option', name: 'mode' } },
        label: 'mode',
        value: 'fast',
      },
      {
        context: { ...shared, input: { global: false, kind: 'argument', name: 'name' } },
        label: 'name',
        value: 'one',
      },
      {
        context: { ...shared, input: { global: false, kind: 'argument', name: 'files' } },
        label: 'files',
        value: 'two',
      },
      {
        context: { ...shared, input: { global: false, kind: 'argument', name: 'files' } },
        label: 'files',
        value: 'three',
      },
      {
        context: { ...shared, input: { global: false, kind: 'option', name: 'single' } },
        label: 'single',
        value: 's',
      },
      {
        context: { ...shared, input: { global: false, kind: 'option', name: 'multi' } },
        label: 'multi',
        value: 'a',
      },
      {
        context: { ...shared, input: { global: false, kind: 'option', name: 'multi' } },
        label: 'multi',
        value: 'b',
      },
    ],
    sameHost: true,
  });
});

test('a nested Command reports its whole route and its own supplied inputs', async () => {
  const argv = ['cache', 'clear', '--force', 'yes', '--mode', 'fast'];
  const shared = {
    command: ['cache', 'clear'],
    host: { argv, cwd },
    passthrough: [],
    phase: 'invocation',
    supplied: { args: {}, options: { force: 'yes', mode: 'fast' } },
    suppliedKey: true,
  };
  await expect(context('nested', argv)).resolves.toEqual({
    records: [
      {
        context: { ...shared, input: { global: true, kind: 'option', name: 'mode' } },
        label: 'mode',
        value: 'fast',
      },
      {
        context: { ...shared, input: { global: false, kind: 'option', name: 'force' } },
        label: 'force',
        value: 'yes',
      },
    ],
    sameHost: true,
  });
});

test('a route walked through aliases reports the canonical names', async () => {
  const argv = ['c', 'cl', '--force', 'yes', '--mode', 'fast'];
  const shared = {
    command: ['cache', 'clear'],
    host: { argv, cwd },
    passthrough: [],
    phase: 'invocation',
    supplied: { args: {}, options: { force: 'yes', mode: 'fast' } },
    suppliedKey: true,
  };
  await expect(context('nested', argv)).resolves.toEqual({
    records: [
      {
        context: { ...shared, input: { global: true, kind: 'option', name: 'mode' } },
        label: 'mode',
        value: 'fast',
      },
      {
        context: { ...shared, input: { global: false, kind: 'option', name: 'force' } },
        label: 'force',
        value: 'yes',
      },
    ],
    sameHost: true,
  });
});

test('a default validates in its own phase, with the host and no supplied inputs', async () => {
  const argv = ['--size', '2'];
  const host = { argv, cwd };
  await expect(context('default', argv)).resolves.toEqual({
    records: [
      {
        context: {
          host,
          input: { global: false, kind: 'option', name: 'depth' },
          phase: 'default',
          suppliedKey: false,
        },
        label: 'depth',
        value: '1',
      },
      {
        context: {
          command: [],
          host,
          input: { global: false, kind: 'option', name: 'size' },
          passthrough: [],
          phase: 'invocation',
          supplied: { args: {}, options: { depth: none, size: '2' } },
          suppliedKey: true,
        },
        label: 'size',
        value: '2',
      },
    ],
    sameHost: true,
  });
});

test('a schema another caller runs, and a foreign carrier, read no context', async () => {
  await expect(context('direct')).resolves.toEqual({
    foreign: null,
    none: null,
    records: [{ context: null, label: 'direct', value: 'value' }],
  });
});

test('the context is a snapshot, so a validator that writes to it changes nothing', async () => {
  await expect(context('snapshot', ['a', 'b', '--multi', 'x', '--', 'tail'])).resolves.toEqual({
    args: { files: ['a', 'b'] },
    options: { multi: ['x'] },
    passthrough: ['tail'],
    seen: [{ command: [], files: ['a', 'b'], multi: ['x'], passthrough: ['tail'], value: 'x' }],
  });
});

test('a Zod schema validates as it does without the context', async () => {
  await expect(context('zod', ['--size', '12'])).resolves.toEqual({ size: 12 });
  const failed = await invokeFixture(new URL('fixtures/validation-context.mjs', import.meta.url), [
    'zod',
    '--size',
    'bad',
  ]);
  expect(failed.status).toBe(2);
  expect(failed.stdout).toBe('');
  expect(failed.stderr).toBe('context: Option "--size": Use decimal digits.\n');
});
