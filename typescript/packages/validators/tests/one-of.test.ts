// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { expect, expectTypeOf, test } from 'vite-plus/test';

import { oneOf } from '../src/index.js';
import type { Validator } from '../src/index.js';
import {
  conforms,
  declarationFault,
  faultOf,
  published,
  rejectedWith,
  rejection,
  verdict,
} from './support.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

const metric = oneOf(['bytes', 'words', 'lines']);

test('the output is typed as the union of the declared literals', () => {
  expectTypeOf(metric).toEqualTypeOf<Validator<'bytes' | 'words' | 'lines'>>();
});

test.each(['bytes', 'words', 'lines'])('accepts %j', async (token) => {
  await expect(verdict(metric, token)).resolves.toEqual({ value: token });
  expect(conforms(metric, token)).toBe(true);
});

test('accepts the one value of a single-value list', async () => {
  const only = oneOf(['only']);
  await expect(verdict(only, 'only')).resolves.toEqual({ value: 'only' });
  expect(conforms(only, 'only')).toBe(true);
});

test.each(['Bytes', 'BYTES', '', 'chars', 'bytes '])('rejects %j', async (token) => {
  await expect(rejection(metric, token)).resolves.toEqual(
    rejectedWith('Expected one of: bytes, words, lines.'),
  );
});

test('a single-value list names its value', async () => {
  await expect(rejection(oneOf(['only']), 'other')).resolves.toEqual(
    rejectedWith('Expected one of: only.'),
  );
});

test('publishes the values as an enum in the declared order', () => {
  expect(published(metric)).toEqual({
    $schema: dialect,
    enum: ['bytes', 'words', 'lines'],
    type: 'string',
  });
});

test('a value listed twice throws a declaration fault from the call', () => {
  expect(faultOf(() => oneOf(['dev', 'prod', 'dev']))).toEqual(
    declarationFault('oneOf() lists "dev" twice. List each value once.'),
  );
});
