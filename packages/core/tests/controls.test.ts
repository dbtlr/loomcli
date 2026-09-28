import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The escaped form of each text, read back from the fixture as JSON. */
function escaped(texts: string[]): unknown {
  const result = invoke(new URL('fixtures/controls.mjs', import.meta.url), [JSON.stringify(texts)]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

/**
 * One code point named by its hexadecimal digits, such as `202E`, between two letters, and the
 * four-digit lowercase escape the text reads as once escaped, backslash included.
 */
function surrounded(hex: string): { raw: string; escape: string } {
  const character = String.fromCodePoint(Number.parseInt(hex, 16));
  return { escape: `a\\u${hex.toLowerCase().padStart(4, '0')}b`, raw: `a${character}b` };
}

test.each(['0000', '001B', '007F', '0085', '2028', '2029'])(
  'the control character or line separator U+%s is escaped',
  (hex) => {
    const { escape, raw } = surrounded(hex);
    expect(escaped([raw])).toEqual([escape]);
  },
);

test.each([
  '202A',
  '202B',
  '202C',
  '202D',
  '202E',
  '2066',
  '2067',
  '2068',
  '2069',
  '200E',
  '200F',
  '061C',
])('the bidirectional control U+%s is escaped', (hex) => {
  const { escape, raw } = surrounded(hex);
  expect(escaped([raw])).toEqual([escape]);
});

test('other format characters and the neighbors of the escaped ranges stay as they are', () => {
  const kept = [
    // A zero-width joiner inside an emoji, a soft hyphen, and a zero-width space.
    '\u{1f469}\u{200d}\u{1f4bb}',
    'co\u{ad}op',
    'a\u{200b}b',
    // The code points just outside each escaped range.
    'a\u{200d}b',
    'a\u{2010}b',
    'a\u{202f}b',
    'a\u{2065}b',
    'a\u{206a}b',
    'a\u{61b}b',
    'a\u{61d}b',
  ];
  expect(escaped(kept)).toEqual(kept);
});
