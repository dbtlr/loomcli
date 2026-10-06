import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/media-types.mjs', import.meta.url);

/** The fixture's output for one scenario, which ran without a fault of its own. */
function report(scenario: string): string {
  const result = invoke(fixture, [scenario]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

test('each store keeps the media type its view declared, by view name in record order', () => {
  const {
    declared,
    mediaTypes,
  }: { declared: string; mediaTypes: Record<string, Record<string, string | null> | null> } =
    JSON.parse(report('stores'));
  expect(declared).toBe('text/plain');
  expect(mediaTypes).toEqual({
    '': null,
    rows: { hooked: 'application/x-hooked', lines: 'application/jsonl', odd: 'nonsense' },
    value: { added: 'text/markdown', csv: 'text/csv', page: 'text/plain', plain: null },
  });
  expect(Object.keys(mediaTypes.value ?? {})).toEqual(['csv', 'page', 'plain', 'added']);
  expect(Object.keys(mediaTypes.rows ?? {})).toEqual(['lines', 'odd', 'hooked']);
});

test("a views() call that replaces a key replaces that view's media type in place", () => {
  expect(JSON.parse(report('replaced'))).toEqual({ '': null, value: { json: null, text: null } });
});

test('core never checks a media type against the text its view writes', () => {
  expect(report('unchecked')).toBe('not json\n');
});

test('a media type that is not a string is rejected at the call that stores the view', () => {
  expect(JSON.parse(report('faults'))).toEqual({
    declared: '@loomcli/core/media-type',
    result: '@loomcli/core/media-type',
    views: '@loomcli/core/media-type',
  });
});
