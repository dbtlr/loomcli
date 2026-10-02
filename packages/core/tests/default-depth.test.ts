import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/default-depth.mjs', import.meta.url);

/** How one declaring call ended with a default nested `levels` deep, from the fixture's one line. */
function declared(call: string, levels: number, shape = 'straight'): unknown {
  const result = invoke(fixture, [call, String(levels), shape]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

/** The fault each declaring call reports for a default nested past the limit. */
const tooDeep = {
  argument: { mark: '1.default', subject: 'Argument "path"' },
  global: { mark: '1.default', subject: 'Option "format"' },
  hook: { mark: '1.default', subject: 'Option "format"' },
  option: { mark: '1.default', subject: 'Option "format"' },
  plugin: { mark: '1.options.format.default', subject: 'Plugin "@acme/probe" option "format"' },
};

test.each(Object.entries(tooDeep))(
  'a %s default nested eleven levels deep is a declaration fault at its call',
  (call, { mark, subject }) => {
    expect(declared(call, 11)).toEqual({
      correction: 'Nest a default at most 10 levels deep.',
      mark: [mark],
      rule: '@loomcli/core/default-depth',
      sentence: `${subject} default nests deeper than 10 levels.`,
    });
  },
);

test.each(['argument', 'global', 'hook', 'option'])(
  'a %s default nested ten levels deep is declared',
  (call) => {
    expect(declared(call, 10)).toBe('returned');
  },
);

test('a default nested far past the call stack reports its depth, not an unreadable config', () => {
  expect(declared('option', 5000)).toMatchObject({ rule: '@loomcli/core/default-depth' });
});

test('a path through containers the walk already copied counts every one of them', () => {
  expect(declared('option', 10, 'shared')).toBe('returned');
  expect(declared('option', 11, 'shared')).toMatchObject({ rule: '@loomcli/core/default-depth' });
  expect(declared('option', 5000, 'shared')).toMatchObject({
    rule: '@loomcli/core/default-depth',
  });
});

test.each(['cycle', 'indirect'])(
  'a default that holds itself (%s) nests without end, whatever its depth',
  (shape) => {
    expect(declared('option', 2, shape)).toEqual({
      correction: 'Nest a default at most 10 levels deep.',
      mark: ['1.default'],
      rule: '@loomcli/core/default-depth',
      sentence: 'Option "format" default nests deeper than 10 levels.',
    });
  },
);
