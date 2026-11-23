/*
 * How one real path stands to another, which the build's overlap guards read before they replace a
 * folder whole. A root ends in its separator, so a path inside it is read as inside, and the root
 * holds it, on POSIX and on Windows.
 */
import { expect, test } from 'vite-plus/test';

import { relationOf } from '../src/helpers/path-relation.js';

test.each([
  { other: '/notes', path: '/notes', relation: 'is', separator: '/' },
  { other: '/notes', path: '/notes/dist', relation: 'is inside', separator: '/' },
  { other: '/notes/dist', path: '/notes', relation: 'holds', separator: '/' },
  { other: '/notes', path: '/notes-old', relation: undefined, separator: '/' },
  { other: '/notes', path: '/', relation: 'holds', separator: '/' },
  { other: '/', path: '/notes', relation: 'is inside', separator: '/' },
  { other: String.raw`C:\notes`, path: 'C:\\', relation: 'holds', separator: '\\' },
  { other: 'C:\\', path: String.raw`C:\notes`, relation: 'is inside', separator: '\\' },
  { other: String.raw`C:\notes`, path: 'D:\\', relation: undefined, separator: '\\' },
] as const)('$path against $other reads as $relation', ({ other, path, relation, separator }) => {
  expect(relationOf(path, other, separator)).toBe(relation);
});
