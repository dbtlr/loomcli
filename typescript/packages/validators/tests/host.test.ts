// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { describe, expect, it } from 'vite-plus/test';

import { host } from '../src/index.js';
import { conforms, published, rejectedWith, rejection, verdict } from './support.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

const hostSentence = 'Expected a host name, such as example.com.';
const hostOrIpSentence =
  'Expected a host name or an IP address, such as example.com, 192.0.2.1, or [2001:db8::1].';

const label63 = 'a'.repeat(63);

/** A name of exactly 253 characters: three labels of 63 and one of 61. */
const longest = `${label63}.${label63}.${label63}.${'b'.repeat(61)}`;

/** Host names and the lowercase output each gives, under either configuration. */
const names: [string, string][] = [
  ['example.com', 'example.com'],
  ['EXAMPLE.COM', 'example.com'],
  ['Db.Internal', 'db.internal'],
  ['localhost', 'localhost'],
  ['a', 'a'],
  ['a-b.c', 'a-b.c'],
  ['a--b.example', 'a--b.example'],
  ['xn--bcher-kva.example', 'xn--bcher-kva.example'],
  ['1example.com', '1example.com'],
  ['123.example', '123.example'],
  ['1.2.3.example', '1.2.3.example'],
  ['example.123a', 'example.123a'],
  ['foo.0xg', 'foo.0xg'],
  ['foo.x0', 'foo.x0'],
  ['a.b.c.d.e', 'a.b.c.d.e'],
  [label63, label63],
  [longest, longest],
];

/** Tokens that are not host names, under either configuration. */
const notNames = [
  '',
  'example.org.',
  '\u212A.example',
  '.example.org',
  'example..org',
  '-example.org',
  'example-.org',
  'exa_mple.org',
  '_service.example.org',
  'bücher.example',
  'ex ample.org',
  ' example.org',
  'example.org ',
  'example.org:80',
  'http://example.org',
  'a'.repeat(64),
  `${longest}c`,
  `${longest}.c`,
  '0x7f000001',
  '0X7F000001',
  '127.0.0.0x1',
  'foo.0x',
  'foo.0X1F',
  'foo.0xff',
  '123',
  'example.123',
  '192.0.2.01',
  '1.2.3',
  '1.2.3.4.5',
  '[192.0.2.10]',
  '[example.org]',
  '[]',
  '[::1',
  '::2]',
  '[[::1]]',
  '[fe80::1%eth0]',
];

describe('host', () => {
  it.each(names)('accepts %j as %j', async (token, name) => {
    await expect(verdict(host(), token)).resolves.toEqual({ value: name });
    expect(conforms(host(), token)).toBe(true);
  });

  it.each([...notNames, '1.2.3.4', '192.0.2.10', '::1', '[::1]', '[2001:db8::2]'])(
    'rejects %j',
    async (token) => {
      await expect(rejection(host(), token)).resolves.toEqual(rejectedWith(hostSentence));
    },
  );

  it('publishes the hostname format', () => {
    expect(published(host())).toEqual({ $schema: dialect, format: 'hostname', type: 'string' });
    expect(published(host({ ip: false }))).toEqual(published(host()));
  });
});

describe('host with ip', () => {
  const withIp = host({ ip: true });

  it.each([
    ...names,
    ['192.0.2.1', '192.0.2.1'],
    ['0.0.0.0', '0.0.0.0'],
    ['1.2.3.4', '1.2.3.4'],
    ['[2001:DB8::1]', '2001:db8::1'],
    ['[2001:db8:0:0:0:0:0:1]', '2001:db8::1'],
    ['[::1]', '::1'],
    ['[::]', '::'],
    ['[::ffff:192.0.2.1]', '::ffff:192.0.2.1'],
    ['[::ffff:c000:201]', '::ffff:192.0.2.1'],
    ['[64:ff9b::192.0.2.33]', '64:ff9b::c000:221'],
  ])('accepts %j as %j', async (token, value) => {
    await expect(verdict(withIp, token)).resolves.toEqual({ value });
    expect(conforms(withIp, token)).toBe(true);
  });

  it.each([...notNames, '2001:db8::2', '::2', '::ffff:192.0.2.10', '[::1]:80', 'x[::1]'])(
    'rejects %j',
    async (token) => {
      await expect(rejection(withIp, token)).resolves.toEqual(rejectedWith(hostOrIpSentence));
    },
  );

  it('publishes the hostname and ipv4 formats beside a pattern for a bracketed address', () => {
    expect(published(withIp)).toEqual({
      $schema: dialect,
      anyOf: [
        { format: 'hostname' },
        { format: 'ipv4' },
        { pattern: String.raw`^\[[0-9A-Fa-f:.]+\]$` },
      ],
      type: 'string',
    });
  });

  it.each(['[]', '[g::]', '2001:db8::1', '[::1', 'exa_mple.org'])(
    'the published schema refuses %j',
    (token) => {
      expect(conforms(withIp, token)).toBe(false);
    },
  );
});
