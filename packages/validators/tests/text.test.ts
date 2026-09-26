import { describe, expect, it, test } from 'vite-plus/test';

import { text } from '../src/index.js';
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

describe('accepted tokens pass unchanged and satisfy the published schema', () => {
  const accepted: [string, ReturnType<typeof text>, string][] = [
    ['text() a letter', text(), 'a'],
    ['text() a phrase', text(), 'hello world'],
    ['text() one astral code point', text(), '😀'],
    ['text() the last code point', text(), '\u{10FFFF}'],
    ['minLength 0 the empty string', text({ minLength: 0 }), ''],
    ['maxLength 2 two astral code points', text({ maxLength: 2 }), '😀😀'],
    ['minLength 3 three astral code points', text({ minLength: 3 }), '😀😀😀'],
    ['exactly 2 astral code points', text({ maxLength: 2, minLength: 2 }), '𝒜𝒜'],
    ['an anchored pattern', text({ pattern: /^[a-z]+$/ }), 'abc'],
    ['a pattern that needs the u flag', text({ pattern: /^\p{L}+$/u }), 'éß'],
    ['a dot matches one astral code point', text({ pattern: /^.$/ }), '😀'],
    ['an unanchored pattern matches anywhere', text({ pattern: /b/ }), 'abc'],
  ];

  it.each(accepted)('%s', async (_name, validator, token) => {
    await expect(verdict(validator, token)).resolves.toEqual({ value: token });
    expect(conforms(validator, token)).toBe(true);
  });
});

describe('rejected tokens read the one sentence for the configuration', () => {
  const lower = /^[a-z]+$/;
  const rejected: [string, ReturnType<typeof text>, string, string][] = [
    ['text() the empty string', text(), '', 'Expected a nonempty value.'],
    ['minLength 2 one letter', text({ minLength: 2 }), 'z', 'Expected at least 2 characters.'],
    [
      'minLength 2 one astral code point',
      text({ minLength: 2 }),
      '😀',
      'Expected at least 2 characters.',
    ],
    [
      'minLength 0, maxLength 3, four letters',
      text({ maxLength: 3, minLength: 0 }),
      'abcd',
      'Expected at most 3 characters.',
    ],
    [
      'minLength 0, maxLength 3, four astral code points',
      text({ maxLength: 3, minLength: 0 }),
      '😀😀😀😀',
      'Expected at most 3 characters.',
    ],
    [
      'minLength 0, maxLength 1',
      text({ maxLength: 1, minLength: 0 }),
      'ab',
      'Expected at most 1 character.',
    ],
    [
      'minLength equal to maxLength',
      text({ maxLength: 8, minLength: 8 }),
      'short',
      'Expected exactly 8 characters.',
    ],
    [
      'minLength equal to maxLength of 1',
      text({ maxLength: 1, minLength: 1 }),
      'ab',
      'Expected exactly 1 character.',
    ],
    [
      'maxLength 32 the empty string',
      text({ maxLength: 32 }),
      '',
      'Expected from 1 through 32 characters.',
    ],
    [
      'maxLength 32 thirty-three letters',
      text({ maxLength: 32 }),
      'x'.repeat(33),
      'Expected from 1 through 32 characters.',
    ],
    [
      'a pattern without a message',
      text({ pattern: lower }),
      'ABC',
      'Expected a value that matches the required pattern.',
    ],
    [
      'a pattern with a message',
      text({ message: 'Expected lowercase letters.', pattern: lower }),
      'ABC',
      'Expected lowercase letters.',
    ],
    [
      'a token that fails length and pattern reads the length sentence',
      text({ maxLength: 3, pattern: lower }),
      'ABCDE',
      'Expected from 1 through 3 characters.',
    ],
    [
      'the empty string under a pattern reads the length sentence',
      text({ pattern: lower }),
      '',
      'Expected a nonempty value.',
    ],
    [
      'a dot under the u flag',
      text({ pattern: /^.$/ }),
      'ab',
      'Expected a value that matches the required pattern.',
    ],
  ];

  it.each(rejected)('%s', async (_name, validator, token, message) => {
    await expect(rejection(validator, token)).resolves.toEqual(rejectedWith(message));
  });
});

test('text() publishes minLength 1 and nothing else', () => {
  expect(published(text())).toEqual({ $schema: dialect, minLength: 1, type: 'string' });
});

test('text() publishes each bound and the pattern source', () => {
  expect(published(text({ maxLength: 32, minLength: 0, pattern: /^[a-z]+$/u }))).toEqual({
    $schema: dialect,
    maxLength: 32,
    minLength: 0,
    pattern: '^[a-z]+$',
    type: 'string',
  });
});

describe('an option that can never work throws from the call', () => {
  const faults: [string, unknown, string][] = [
    [
      'options that are not an object',
      null,
      'text() options is not a plain object. Supply an object or leave it out.',
    ],
    [
      'a negative minLength',
      { minLength: -1 },
      'text() minLength is not a non-negative safe integer. Supply a whole number of 0 or more.',
    ],
    [
      'a fractional minLength',
      { minLength: 1.5 },
      'text() minLength is not a non-negative safe integer. Supply a whole number of 0 or more.',
    ],
    [
      'a string maxLength',
      { maxLength: '3' },
      'text() maxLength is not a non-negative safe integer. Supply a whole number of 0 or more.',
    ],
    [
      'an unsafe maxLength',
      { maxLength: 2 ** 53 },
      'text() maxLength is not a non-negative safe integer. Supply a whole number of 0 or more.',
    ],
    [
      'minLength above maxLength',
      { maxLength: 2, minLength: 5 },
      'text() minLength 5 is above maxLength 2. Supply a minLength at or below maxLength.',
    ],
    [
      'the default minLength above maxLength',
      { maxLength: 0 },
      'text() minLength 1 is above maxLength 0. Supply a minLength at or below maxLength.',
    ],
    [
      'a pattern that is not a RegExp',
      { pattern: '^a$' },
      'text() pattern is not a RegExp. Supply a regular expression literal.',
    ],
    [
      'a pattern with the g flag',
      { pattern: /a/g },
      'text() pattern carries the flag g. Supply a pattern with no flag other than u.',
    ],
    [
      'a pattern with two other flags',
      { pattern: /a/giu },
      'text() pattern carries the flags gi. Supply a pattern with no flag other than u.',
    ],
    [
      'a pattern that does not compile under u',
      // oxlint-disable-next-line no-useless-escape -- The identity escape is valid only without u.
      { pattern: /\-/ },
      'text() pattern does not compile under the u flag. Supply a pattern that is valid with the u flag.',
    ],
    [
      'an empty message',
      { message: '', pattern: /a/ },
      'text() message is not a nonempty string. Supply one sentence that states the expectation.',
    ],
    [
      'a message that is not a string',
      { message: 5, pattern: /a/ },
      'text() message is not a nonempty string. Supply one sentence that states the expectation.',
    ],
    [
      'a message without a pattern',
      { message: 'Expected lowercase letters.' },
      'text() message has no pattern to describe. Supply a pattern or leave out message.',
    ],
  ];

  it.each(faults)('%s', (_name, options, message) => {
    expect(faultOf(() => Reflect.apply(text, undefined, [options]))).toEqual(
      declarationFault(message),
    );
  });
});
