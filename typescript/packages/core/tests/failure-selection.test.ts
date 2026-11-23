import { expect, test } from 'vite-plus/test';
/*
 * Acceptance plan for the selection in the failure contexts (docs/core/failure-views.md).
 *
 * `view` and `mediaType` are proven when public APIs alone produce these results under Node and
 * Bun, each read by a fixture view override and a fixture `onFailure` hook alike:
 *
 * - After dispatch. A fixture `list --pick json` that fails after dispatch reads `json` and
 *   `application/json`, and `list` with no `--pick` reads the default view, `table`, and
 *   `undefined`.
 * - A held fault. `list --pick json --depth x` and `list --pick json --bogus` read `json` and
 *   `application/json`, the second because core validates the selecting option under the held
 *   unknown option. `list --depth x` reads the default view, `table`, and `undefined`.
 * - The default view. `list --pick yaml` reads `table` and `undefined`, because the rejected
 *   selection assigns nothing. A fixture Command whose default view is `json()` reads `json` and
 *   `application/json` for a failure with no `--pick`.
 * - No selection. An unknown command under `--pick json`, a build fault, a declared default its
 *   validator rejects, and a failure on a Command that declares no result each read `undefined`
 *   for both.
 * - A bad selection. A fixture middleware that assigns `yaml` to `view` and then calls `next()`
 *   under a held fault reads `undefined` for both.
 * - By name. `invoke(['list'], …, { view: 'json' })` on a failing Command reads `json` and
 *   `application/json` on both contexts.
 */

import { invoke as invokeFixture } from './run-fixture.ts';

async function selection(shape: string, words: string[], env: Record<string, string> = {}) {
  return await invokeFixture(
    new URL('fixtures/failure-selection.mjs', import.meta.url),
    [shape, ...words],
    {
      env,
    },
  ).then((fixtureResult) => fixtureResult.stderr);
}

/** What a failure view and an `onFailure` hook each read of the run's selection. */
function read(view: string, mediaType: string): string {
  return `view:${view}:${mediaType}\nhook:${view}:${mediaType}\n`;
}

test('after dispatch the selection is the view the boundary read, else the default view', async () => {
  await expect(selection('plain', ['list', '--pick', 'json'])).resolves.toBe(
    read('json', 'application/json'),
  );
  await expect(selection('plain', ['list'])).resolves.toBe(read('table', 'undefined'));
});

test('a held fault reads the selection a middleware assigned before the boundary', async () => {
  await expect(selection('plain', ['list', '--pick', 'json', '--depth', 'x'])).resolves.toBe(
    read('json', 'application/json'),
  );
  await expect(selection('plain', ['list', '--pick', 'json', '--bogus'])).resolves.toBe(
    read('json', 'application/json'),
  );
  await expect(selection('plain', ['list', '--depth', 'x'])).resolves.toBe(
    read('table', 'undefined'),
  );
});

test('a rejected selection assigns nothing, so the default view stands', async () => {
  await expect(selection('plain', ['list', '--pick', 'yaml'])).resolves.toBe(
    read('table', 'undefined'),
  );
  await expect(selection('plain', ['wire'])).resolves.toBe(read('json', 'application/json'));
});

test('a build fault, a rejected default, an unknown command, and a Command with no result read no selection', async () => {
  await expect(selection('build', ['list', '--pick', 'json'])).resolves.toBe(
    'view:undefined:undefined\n',
  );
  await expect(selection('default', ['list', '--pick', 'json'])).resolves.toBe(
    read('undefined', 'undefined'),
  );
  await expect(selection('plain', ['nope', '--pick', 'json'])).resolves.toBe(
    read('undefined', 'undefined'),
  );
  await expect(selection('plain', ['get', '--pick', 'json'])).resolves.toBe(
    read('undefined', 'undefined'),
  );
});

test('an assigned name the result does not hold reads no selection', async () => {
  await expect(selection('plain', ['list', '--pick', 'bad', '--bogus'])).resolves.toBe(
    read('undefined', 'undefined'),
  );
});

test('a run by name reads the view it started with', async () => {
  await expect(
    selection('plain', [], { FIXTURE_BY_NAME: JSON.stringify([['list'], 'json']) }),
  ).resolves.toBe(read('json', 'application/json'));
});
