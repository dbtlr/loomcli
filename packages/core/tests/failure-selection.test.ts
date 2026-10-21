/*
 * Acceptance plan for the selection in the failure contexts (docs/core/failure-views.md).
 *
 * `view` and `mediaType` are proven when public APIs alone produce these results under Node and
 * Bun, each read by a fixture view override and a fixture `onFailure` hook alike:
 *
 * - After dispatch. `jsonkit paths --format json -f <document with a refused key>` reads `json` and
 *   `application/json`, and `jsonkit paths -f <the same document>` reads the default view, `list`,
 *   and `undefined`.
 * - A held fault. `textstat --format json --metric nope one.txt` and `textstat --format json
 *   --bogus one.txt` read `json` and `application/json`, the second because core validates the
 *   formatter's `--format` under the held unknown option. `textstat --metric nope one.txt` reads
 *   the default view, `table`, and `undefined`.
 * - The default view. `textstat --format yaml one.txt` reads `table` and `undefined`, because the
 *   rejected `--format` assigns nothing. A fixture Command whose default view is `json()` reads
 *   `json` and `application/json` for a failure with no `--format`.
 * - No selection. `jsonkit typo --format json -f doc.json`, a build fault, a declared default its
 *   validator rejects, and a failure on jsonkit's `get`, which declares no result, each read
 *   `undefined` for both.
 * - A bad selection. A fixture middleware that assigns `yaml` to `view` and then calls `next()`
 *   under a held fault reads `undefined` for both.
 * - By name. `invoke(['paths'], …, { view: 'json' })` against a document with a refused key reads
 *   `json` and `application/json` on both contexts.
 */

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
