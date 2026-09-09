import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/invoke.mjs', import.meta.url);

/** The fixture plugin declares `cache`, `mode`, `quiet`, and `tags`, and activates on all four. */
function settings(argv: string[], mode = 'run') {
  return invoke(fixture, ['settings', mode, ...argv]);
}

/** What the action printed, which never holds a plugin option. */
const dispatched = 'get:a.b:{"raw":false}\naction-signal:true:false\n';

test('a declared default never activates a middleware', () => {
  expect(settings(['get', 'a.b'])).toEqual({
    status: 0,
    stderr: '',
    stdout: `${dispatched}resolved:0\n`,
  });
});

test.each([
  ['--quiet', 'the long spelling'],
  ['-q', 'the short spelling'],
  ['--no-cache', 'a negative Boolean form'],
])('%s activates the middleware, because it is %s of a declared option', (token) => {
  const result = settings([token, 'get', 'a.b']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('settings:');
});

test('a plugin reads its own option values and an action never receives them', () => {
  const result = settings(['-q', '--mode', 'fancy', '--tags', 'a', '--tags', 'b', 'get', 'a.b']);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    `settings:{"cache":false,"mode":"fancy","quiet":true,"tags":["a","b"]}\n${dispatched}resolved:0\n`,
  );
});

test('a plugin option is consumed at any placement, as a global option is', () => {
  const result = settings(['get', 'a.b', '--mode', 'fancy']);
  expect(result.stdout).toBe(
    `settings:{"cache":false,"mode":"fancy","quiet":false,"tags":["one"]}\n${dispatched}resolved:0\n`,
  );
});

test('a declared default is copied afresh for each run', () => {
  // The middleware writes to the collection it received, so a shared array would leak into run two.
  const result = settings(['-q', 'get', 'a.b'], 'twice');
  const line = 'settings:{"cache":false,"mode":"plain","quiet":true,"tags":["one"]}\n';
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: `${line}${dispatched}${line}${dispatched}resolved:0:0\n`,
  });
});

test('a structure fault in a plugin option is the pre-scan input error a global option produces', () => {
  expect(settings(['--mode'])).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--mode" requires a value. Supply a value after "--mode".\n',
    stdout: 'resolved:2\n',
  });
  expect(settings(['-q', 'get', 'a.b', '-q'])).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "-q" can be supplied only once. Remove the repeated option.\n',
    stdout: 'resolved:2\n',
  });
});

test('a short group that mixes a plugin letter reads it as a global option', () => {
  expect(settings(['-qZ', 'get', 'a.b'])).toEqual({
    status: 2,
    stderr:
      'Invalid input: Short group "-qZ" mixes the global option "-q" with "-Z", which is not a global option. Supply global options as separate tokens, and local options after their command name.\n',
    stdout: 'resolved:2\n',
  });
});

test('inspect() lists plugin options after the application globals, with their own scope', () => {
  const result = invoke(fixture, ['settings', 'inspect']);
  expect(result.status).toBe(0);
  const graph = JSON.parse(result.stdout);
  expect(
    graph.globals.map((option: { name: string; scope: string }) => [option.name, option.scope]),
  ).toEqual([
    ['file', 'application'],
    ['cache', 'plugin'],
    ['mode', 'plugin'],
    ['quiet', 'plugin'],
    ['tags', 'plugin'],
  ]);
});

test('a plugin string option reads required, validated, and validateOmitted as false', () => {
  const graph = JSON.parse(invoke(fixture, ['settings', 'inspect']).stdout);
  expect(graph.globals[2]).toEqual({
    default: { value: 'plain' },
    description: undefined,
    extensions: {},
    long: '--mode',
    multiple: false,
    name: 'mode',
    required: false,
    scope: 'plugin',
    short: '-m',
    type: 'string',
    validateOmitted: false,
    validated: false,
  });
  expect(graph.globals[1]).toEqual({
    description: undefined,
    extensions: {},
    long: '--cache',
    name: 'cache',
    negative: '--no-cache',
    polarity: 'both',
    scope: 'plugin',
    short: null,
    type: 'boolean',
  });
});
