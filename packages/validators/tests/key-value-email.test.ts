// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { describe, expect, expectTypeOf, it } from 'vite-plus/test';

import { email, keyValue } from '../src/index.js';
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

// A line terminator and a space beyond ASCII, written by code point so they stay visible.
const lineSeparator = String.fromCodePoint(0x20_28);
const noBreakSpace = String.fromCodePoint(0xa0);

describe('keyValue', () => {
  it('the output is a key and a value, both strings', () => {
    expectTypeOf(keyValue()).toEqualTypeOf<Validator<{ key: string; value: string }>>();
  });

  it.each([
    ['env=prod', 'env', 'prod'],
    ['a=b=c', 'a', 'b=c'],
    ['a==', 'a', '='],
    ['a=', 'a', ''],
    ['a b=c d', 'a b', 'c d'],
    [' a = b ', ' a ', ' b '],
    ['multi\nline=x\ny', 'multi\nline', 'x\ny'],
    ['\n=x', '\n', 'x'],
    [`${lineSeparator}=x`, lineSeparator, 'x'],
    ['ключ=значение', 'ключ', 'значение'],
    ['😀=1', '😀', '1'],
  ])('splits %j at the first =', async (token, key, value) => {
    await expect(verdict(keyValue(), token)).resolves.toEqual({ value: { key, value } });
    expect(conforms(keyValue(), token)).toBe(true);
  });

  it.each([
    [':', 'host:port', 'host', 'port'],
    [':', 'a::b', 'a', ':b'],
    ['::', 'a::b::c', 'a', 'b::c'],
    ['=>', 'a=>b', 'a', 'b'],
    ['-', 'a-b', 'a', 'b'],
    ['+', 'a+b', 'a', 'b'],
    ['.', 'a.b', 'a', 'b'],
    ['.*', 'a.*b', 'a', 'b'],
    ['|', 'a|b', 'a', 'b'],
    ['$', 'a$b', 'a', 'b'],
    ['^', 'a^b', 'a', 'b'],
    ['\\', String.raw`a\b`, 'a', 'b'],
    ['?', 'a?b', 'a', 'b'],
    ['(', 'a(b', 'a', 'b'],
    [')', 'a)b', 'a', 'b'],
    ['[', 'a[b', 'a', 'b'],
    [']', 'a]b', 'a', 'b'],
    ['{', 'a{b', 'a', 'b'],
    ['}', 'a}b', 'a', 'b'],
    ['/', 'a/b', 'a', 'b'],
    [',', 'a,b', 'a', 'b'],
    ['#', 'a#b', 'a', 'b'],
    ['→', 'a→b', 'a', 'b'],
  ])('with the separator %j splits %j', async (separator, token, key, value) => {
    const validator = keyValue({ separator });
    await expect(verdict(validator, token)).resolves.toEqual({ value: { key, value } });
    expect(conforms(validator, token)).toBe(true);
  });

  it.each(['env', '', '=prod', '==', '\t', 'a:b'])('rejects %j', async (token) => {
    await expect(rejection(keyValue(), token)).resolves.toEqual(
      rejectedWith('Expected a key and a value as key=value.'),
    );
  });

  it('rejects the separator alone, which its own sentence holds, with the same sentence', async () => {
    const result = await verdict(keyValue(), '=');
    expect(result.issues?.map((issue) => issue.message)).toEqual([
      'Expected a key and a value as key=value.',
    ]);
  });

  it('names its own separator in the sentence', async () => {
    await expect(rejection(keyValue({ separator: ':' }), 'a=b')).resolves.toEqual(
      rejectedWith('Expected a key and a value as key:value.'),
    );
    await expect(rejection(keyValue({ separator: '::' }), ':x')).resolves.toEqual(
      rejectedWith('Expected a key and a value as key::value.'),
    );
  });

  it.each([
    ['=', String.raw`^[\s\S]+=`],
    [':', String.raw`^[\s\S]+:`],
    ['-', String.raw`^[\s\S]+-`],
    ['+', String.raw`^[\s\S]+\+`],
    ['.*', String.raw`^[\s\S]+\.\*`],
    ['a|b', String.raw`^[\s\S]+a\|b`],
    ['\\', String.raw`^[\s\S]+\\`],
    ['[]', String.raw`^[\s\S]+\[\]`],
    ['(?)', String.raw`^[\s\S]+\(\?\)`],
    ['{$^}', String.raw`^[\s\S]+\{\$\^\}`],
    ['/', String.raw`^[\s\S]+/`],
  ])('the separator %j publishes the pattern %j', (separator, pattern) => {
    expect(published(keyValue({ separator }))).toEqual({
      $schema: dialect,
      pattern,
      type: 'string',
    });
  });

  it('the default separator publishes the = pattern', () => {
    expect(published(keyValue())).toEqual(published(keyValue({ separator: '=' })));
  });

  it.each(['', 'env', '=prod'])('the published pattern refuses %j', (token) => {
    expect(conforms(keyValue(), token)).toBe(false);
  });

  it('an empty separator throws at the call', () => {
    expect(faultOf(() => keyValue({ separator: '' }))).toEqual(
      declarationFault(
        'keyValue() separator is empty. Supply one character or more with no whitespace, such as "=" or ":".',
      ),
    );
  });

  it.each([' ', 'a b', '\t', '=\n', noBreakSpace, lineSeparator, ': '])(
    'the separator %j, which holds whitespace, throws at the call',
    (separator) => {
      expect(faultOf(() => keyValue({ separator }))).toEqual(
        declarationFault(
          'keyValue() separator holds whitespace. Supply one character or more with no whitespace, such as "=" or ":".',
        ),
      );
    },
  );
});

describe('email', () => {
  const longLabel = 'a'.repeat(63);

  it.each([
    'name@example.com',
    'ops@localhost',
    'A.Name@Example.COM',
    'a..b@example.com',
    '.a@example.com',
    'a.@example.com',
    "o'brien+tag@example.co.uk",
    "#!$%&'*+/=?^_`{|}~-@example.com",
    'x@a-b.c',
    'x@a--b.c',
    'x@1.2.3.4',
    `x@${longLabel}.example`,
  ])('accepts %j as written', async (token) => {
    await expect(verdict(email(), token)).resolves.toEqual({ value: token });
    expect(conforms(email(), token)).toBe(true);
  });

  it.each([
    '',
    'ops',
    '@example.org',
    'ops@',
    'ops@-example.org',
    'ops@example-.org',
    'ops@example..org',
    'ops@.example.org',
    'ops@example.org.',
    'ops@exa_mple.org',
    'ops@example.org:25',
    '"john doe"@example.org',
    'john doe@example.org',
    'ops(comment)@example.org',
    'ops@[192.0.2.1]',
    'ops@example.org\nx',
    'ops@ſ.example',
    '\u212A@example.org',
    'ops@[IPv6:2001:db8::1]',
    'ü@example.org',
    'ops@bücher.example',
    'a@b@example.org',
    ' ops@example.org',
    'ops@example.org ',
    `ops@${longLabel}a.example`,
  ])('rejects %j', async (token) => {
    await expect(rejection(email(), token)).resolves.toEqual(
      rejectedWith('Expected an email address, such as name@example.com.'),
    );
  });

  it('publishes the WHATWG production as a pattern, not the email format', () => {
    const label = '[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?';
    expect(published(email())).toEqual({
      $schema: dialect,
      pattern: String.raw`^[a-zA-Z0-9.!#$%&'*+/=?^_${'`'}{|}~-]+@${label}(?:\.${label})*$`,
      type: 'string',
    });
  });

  it.each(['ops', '"john doe"@example.org', 'ops@example.org.'])(
    'the published pattern refuses %j',
    (token) => {
      expect(conforms(email(), token)).toBe(false);
    },
  );
});
