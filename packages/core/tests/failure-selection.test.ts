import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function selection(shape: string, words: string[], env: Record<string, string> = {}) {
  return invoke(new URL('fixtures/failure-selection.mjs', import.meta.url), [shape, ...words], {
    env,
  }).stderr;
}

/** What a failure view and an `onFailure` hook each read of the run's selection. */
function read(view: string, mediaType: string): string {
  return `view:${view}:${mediaType}\nhook:${view}:${mediaType}\n`;
}

test('after dispatch the selection is the view the boundary read, else the default view', () => {
  expect(selection('plain', ['list', '--pick', 'json'])).toBe(read('json', 'application/json'));
  expect(selection('plain', ['list'])).toBe(read('table', 'undefined'));
});

test('a held fault reads the selection a middleware assigned before the boundary', () => {
  expect(selection('plain', ['list', '--pick', 'json', '--depth', 'x'])).toBe(
    read('json', 'application/json'),
  );
  expect(selection('plain', ['list', '--pick', 'json', '--bogus'])).toBe(
    read('json', 'application/json'),
  );
  expect(selection('plain', ['list', '--depth', 'x'])).toBe(read('table', 'undefined'));
});

test('a rejected selection assigns nothing, so the default view stands', () => {
  expect(selection('plain', ['list', '--pick', 'yaml'])).toBe(read('table', 'undefined'));
  expect(selection('plain', ['wire'])).toBe(read('json', 'application/json'));
});

test('a build fault, a rejected default, an unknown command, and a Command with no result read no selection', () => {
  expect(selection('build', ['list', '--pick', 'json'])).toBe('view:undefined:undefined\n');
  expect(selection('default', ['list', '--pick', 'json'])).toBe(read('undefined', 'undefined'));
  expect(selection('plain', ['nope', '--pick', 'json'])).toBe(read('undefined', 'undefined'));
  expect(selection('plain', ['get', '--pick', 'json'])).toBe(read('undefined', 'undefined'));
});

test('an assigned name the result does not hold reads no selection', () => {
  expect(selection('plain', ['list', '--pick', 'bad', '--bogus'])).toBe(
    read('undefined', 'undefined'),
  );
});

test('a run by name reads the view it started with', () => {
  expect(selection('plain', [], { FIXTURE_BY_NAME: JSON.stringify([['list'], 'json']) })).toBe(
    read('json', 'application/json'),
  );
});
