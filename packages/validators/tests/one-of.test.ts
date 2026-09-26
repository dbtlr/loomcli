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

test('the values are copied at the call', async () => {
  const values: [string, ...string[]] = ['a', 'b'];
  const validator = oneOf(values);
  values.push('z');
  await expect(rejection(validator, 'z')).resolves.toEqual(rejectedWith('Expected one of: a, b.'));
  expect(published(validator)).toEqual({ $schema: dialect, enum: ['a', 'b'], type: 'string' });
});

const faults: [string, unknown, string][] = [
  ['an empty list', [], 'oneOf() values is empty. List at least one value.'],
  [
    'a list that is not an array',
    'dev',
    'oneOf() values is not an array. Supply an array of strings.',
  ],
  [
    'a value that is not a string',
    ['dev', 1],
    'oneOf() lists a value that is not a string. List strings only.',
  ],
  ['an empty string', ['dev', ''], 'oneOf() lists an empty string. List nonempty values only.'],
  [
    'a value listed twice',
    ['dev', 'prod', 'dev'],
    'oneOf() lists "dev" twice. List each value once.',
  ],
];

test.each(faults)('%s throws a declaration fault from the call', (_name, values, message) => {
  expect(faultOf(() => Reflect.apply(oneOf, undefined, [values]))).toEqual(
    declarationFault(message),
  );
});
