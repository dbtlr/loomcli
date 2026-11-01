import { expect, test } from 'vite-plus/test';
/*
 * Acceptance plan for media types (docs/core/results.md#media-types).
 *
 * Media types are proven when public APIs alone produce these results under Node and Bun:
 *
 * - The formatter. `inspect()` reports `mediaTypes` `application/json` for the formatter's `json`
 *   view and `application/jsonl` for its `jsonl` view, and `null` for a view that declares none, as
 *   packages/plugins/tests/format-plugin.test.ts proves.
 * - Each store. A fixture declares a media type on a bare whole view, a row view, a declared view,
 *   a view `views()` adds, and a view a hook adds, and each reads back by name. A view that
 *   declares none reads `null`, a mapped `json()` under the key `wire` reads `application/json`,
 *   and a write to a view object after the call changes no fact.
 * - No check. A media type of `nonsense` is stored as written, and a view whose text is not JSON
 *   under `application/json` renders unchanged.
 * - Faults. The negative type checks reject a `mediaType` of `5` on a result view and on a declared
 *   view.
 */

import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/media-types.mjs', import.meta.url);

/** The fixture's output for one scenario, which ran without a fault of its own. */
async function report(scenario: string): Promise<string> {
  const result = await invokeFixture(fixture, [scenario]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

test('each store keeps the media type its view declared, by view name in record order', async () => {
  const {
    declared,
    mediaTypes,
  }: { declared: string; mediaTypes: Record<string, Record<string, string | null> | null> } =
    JSON.parse(await report('stores'));
  expect(declared).toBe('text/plain');
  expect(mediaTypes).toEqual({
    '': null,
    rows: { hooked: 'application/x-hooked', lines: 'application/jsonl', odd: 'nonsense' },
    value: { added: 'text/markdown', csv: 'text/csv', page: 'text/plain', plain: null },
  });
  expect(Object.keys(mediaTypes.value ?? {})).toEqual(['csv', 'page', 'plain', 'added']);
  expect(Object.keys(mediaTypes.rows ?? {})).toEqual(['lines', 'odd', 'hooked']);
});

test("a views() call that replaces a key replaces that view's media type in place", async () => {
  expect(JSON.parse(await report('replaced'))).toEqual({
    '': null,
    value: { json: null, text: null },
  });
});

test('core never checks a media type against the text its view writes', async () => {
  await expect(report('unchecked')).resolves.toBe('not json\n');
});
