import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The fixture encodes a declared `undefined` as this marker, which JSON alone cannot carry. */
const none = '#undefined';

/** The fixture overrides the captured cwd, so the echoed host is the one the action receives. */
const cwd = '/loom/context';

function context(scenario: string, argv: string[] = []) {
  const result = invoke(new URL('fixtures/validation-context.mjs', import.meta.url), [
    scenario,
    ...argv,
  ]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test('every invocation schema call reads the routed path, passthrough, and supplied tokens', () => {
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
  expect(context('root', argv)).toEqual({
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
        value: ['two', 'three'],
      },
      {
        context: { ...shared, input: { global: false, kind: 'option', name: 'single' } },
        label: 'single',
        value: 's',
      },
      {
        context: { ...shared, input: { global: false, kind: 'option', name: 'multi' } },
        label: 'multi',
        value: ['a', 'b'],
      },
    ],
    sameHost: true,
  });
});

test('a nested Command reports its whole route and its own supplied inputs', () => {
  const argv = ['cache', 'clear', '--force', 'yes', '--mode', 'fast'];
  const shared = {
    command: ['cache', 'clear'],
    host: { argv, cwd },
    passthrough: [],
    phase: 'invocation',
    supplied: { args: {}, options: { force: 'yes', mode: 'fast' } },
    suppliedKey: true,
  };
  expect(context('nested', argv)).toEqual({
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

test('a default validates in its own phase, with the host and no supplied inputs', () => {
  const argv = ['--size', '2'];
  const host = { argv, cwd };
  expect(context('default', argv)).toEqual({
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

test('a schema another caller runs, and a foreign carrier, read no context', () => {
  expect(context('direct')).toEqual({
    foreign: null,
    none: null,
    records: [{ context: null, label: 'direct', value: 'value' }],
  });
});

test('a Zod schema validates as it does without the context', () => {
  expect(context('zod', ['--size', '12'])).toEqual({ size: 12 });
  const failed = invoke(new URL('fixtures/validation-context.mjs', import.meta.url), [
    'zod',
    '--size',
    'bad',
  ]);
  expect(failed.status).toBe(2);
  expect(failed.stderr).toBe('Invalid input: Option "--size": Use decimal digits.\n');
});
