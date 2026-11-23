// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { describe, expect, it } from 'vite-plus/test';

import { cidr, ip } from '../src/index.js';
import { conforms, published, rejectedWith, rejection, verdict } from './support.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

const ipSentence = 'Expected an IP address, such as 192.0.2.1 or 2001:db8::1.';
const ipv4Sentence = 'Expected an IPv4 address, such as 192.0.2.1.';
const ipv6Sentence = 'Expected an IPv6 address, such as 2001:db8::1.';

const cidrSentence = 'Expected a CIDR block, such as 192.0.2.0/24 or 2001:db8::/32.';
const cidrV4Sentence = 'Expected an IPv4 CIDR block, such as 192.0.2.0/24.';
const cidrV6Sentence = 'Expected an IPv6 CIDR block, such as 2001:db8::/32.';
const hostBitsSentence = 'Expected a network address with no bits set below the prefix.';

/** IPv4 tokens, each canonical as written. */
const ipv4Tokens = ['192.0.2.1', '0.0.0.0', '255.255.255.255', '10.0.0.1', '1.2.3.4'];

/** IPv6 tokens and the canonical form RFC 5952 recommends for each. */
const ipv6Tokens: [string, string][] = [
  ['2001:db8::1', '2001:db8::1'],
  ['2001:DB8::1', '2001:db8::1'],
  ['2001:DB8:0:0:0:0:0:1', '2001:db8::1'],
  ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
  ['2001:db8::0:1', '2001:db8::1'],
  ['::', '::'],
  ['0:0:0:0:0:0:0:0', '::'],
  ['::1', '::1'],
  ['1::', '1::'],
  ['fe80::1', 'fe80::1'],
  ['1:0:0:2:0:0:0:3', '1:0:0:2::3'],
  ['1:0:0:2:0:0:3:4', '1::2:0:0:3:4'],
  ['1:0:2:3:4:5:6:7', '1:0:2:3:4:5:6:7'],
  ['1:2:3:4:5:6:7::', '1:2:3:4:5:6:7:0'],
  ['::2:3:4:5:6:7:8', '0:2:3:4:5:6:7:8'],
  ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'],
  ['ABCD:EF01:2345:6789:ABCD:EF01:2345:6789', 'abcd:ef01:2345:6789:abcd:ef01:2345:6789'],
  ['::ffff:192.0.2.1', '::ffff:192.0.2.1'],
  ['::ffff:c000:201', '::ffff:192.0.2.1'],
  ['::FFFF:C000:0201', '::ffff:192.0.2.1'],
  ['0:0:0:0:0:ffff:192.0.2.1', '::ffff:192.0.2.1'],
  ['::ffff:192.0.2.200', '::ffff:192.0.2.200'],
  ['1::ffff:192.0.2.1', '1::ffff:c000:201'],
  ['::ffff:0.0.0.0', '::ffff:0.0.0.0'],
  ['::192.0.2.1', '::c000:201'],
  ['64:ff9b::192.0.2.33', '64:ff9b::c000:221'],
  ['1:2:3:4:5:6:1.2.3.4', '1:2:3:4:5:6:102:304'],
  ['1::5:6:255.255.255.255', '1::5:6:ffff:ffff'],
  ['::1:ffff:192.0.2.1', '::1:ffff:c000:201'],
];

/** Tokens that are an address of neither family. */
const notAddresses = [
  '',
  'abc',
  '192.0.2.01',
  '192.0.2.256',
  '192.0.3',
  '192.0.2.1.5',
  '01.2.3.4',
  '1.2.3.-4',
  '1.2.3.+4',
  ' 192.0.2.10',
  '192.0.2.10 ',
  '0x7f.0.0.1',
  '0x7f000001',
  '3232235777',
  '１.２.３.４',
  '1:2:3:4:5:6:7:8:9',
  '1:2:3:4:5:6:7',
  '1:2:3:4:5:6:7:8::',
  '::1:2:3:4:5:6:7:8',
  '1::2::3',
  ':::',
  '1:::2',
  ':1:2:3:4:5:6:7',
  '1:2:3:4:5:6:7:',
  '12345::',
  'g::',
  'fe80::1%eth0',
  'fe80::1%25eth0',
  '[::1]',
  '::ffff:192.0.2.01',
  '::ffff:192.0.2',
  '::ffff:192.0.2.256',
  '1.2.3.4::',
  '1.2.3.4:1::',
  '::1.2.3.4:5',
  '1:2:3:4:5:6:7:1.2.3.4',
  '1:2:3:4:5:6:7::1.2.3.4',
  '::1.2.3',
];

describe('ip', () => {
  it.each(ipv4Tokens)('accepts the IPv4 address %j as written', async (token) => {
    for (const validator of [ip(), ip({ version: 4 })]) {
      await expect(verdict(validator, token)).resolves.toEqual({ value: token });
      expect(conforms(validator, token)).toBe(true);
    }
  });

  it.each(ipv6Tokens)('accepts the IPv6 address %j as %j', async (token, canonical) => {
    for (const validator of [ip(), ip({ version: 6 })]) {
      await expect(verdict(validator, token)).resolves.toEqual({ value: canonical });
      expect(conforms(validator, token)).toBe(true);
    }
  });

  it.each(notAddresses)('rejects %j', async (token) => {
    await expect(rejection(ip(), token)).resolves.toEqual(rejectedWith(ipSentence));
    await expect(rejection(ip({ version: 4 }), token)).resolves.toEqual(rejectedWith(ipv4Sentence));
    await expect(rejection(ip({ version: 6 }), token)).resolves.toEqual(rejectedWith(ipv6Sentence));
  });

  it('accepts one family alone under version', async () => {
    await expect(rejection(ip({ version: 4 }), '2001:db8::2')).resolves.toEqual(
      rejectedWith(ipv4Sentence),
    );
    await expect(rejection(ip({ version: 4 }), '::ffff:192.0.2.10')).resolves.toEqual(
      rejectedWith(ipv4Sentence),
    );
    await expect(rejection(ip({ version: 6 }), '192.0.2.10')).resolves.toEqual(
      rejectedWith(ipv6Sentence),
    );
  });

  it.each(['2001:DB8::1', '2001:db8:0:0:0:0:0:1', '2001:0db8::0001', '2001:db8:0::0:1'])(
    'gives %j, one spelling of 2001:db8::1, the one output',
    async (token) => {
      await expect(verdict(ip(), token)).resolves.toEqual({ value: '2001:db8::1' });
    },
  );

  it('publishes the format of each family', () => {
    expect(published(ip())).toEqual({
      $schema: dialect,
      anyOf: [{ format: 'ipv4' }, { format: 'ipv6' }],
      type: 'string',
    });
    expect(published(ip({ version: 4 }))).toEqual({
      $schema: dialect,
      format: 'ipv4',
      type: 'string',
    });
    expect(published(ip({ version: 6 }))).toEqual({
      $schema: dialect,
      format: 'ipv6',
      type: 'string',
    });
  });
});

describe('cidr', () => {
  const accepted: [string, string, number][] = [
    ['10.0.0.0/8', '10.0.0.0', 8],
    ['192.0.2.0/24', '192.0.2.0', 24],
    ['0.0.0.0/0', '0.0.0.0', 0],
    ['192.0.2.1/32', '192.0.2.1', 32],
    ['10.128.0.0/9', '10.128.0.0', 9],
    ['2001:db8::/32', '2001:db8::', 32],
    ['2001:DB8:0:0::/64', '2001:db8::', 64],
    ['::/0', '::', 0],
    ['::1/128', '::1', 128],
    ['fe80::/10', 'fe80::', 10],
    ['2001:db8:1234::/48', '2001:db8:1234::', 48],
    ['2001:db8::8000/113', '2001:db8::8000', 113],
    ['::ffff:192.0.2.0/120', '::ffff:192.0.2.0', 120],
    ['::ffff:c000:200/120', '::ffff:192.0.2.0', 120],
  ];

  it.each(accepted)('accepts %j as %j and %d', async (token, address, prefix) => {
    await expect(verdict(cidr(), token)).resolves.toEqual({ value: { address, prefix } });
    expect(conforms(cidr(), token)).toBe(true);
    const family = address.includes(':') ? cidr({ version: 6 }) : cidr({ version: 4 });
    await expect(verdict(family, token)).resolves.toEqual({ value: { address, prefix } });
    expect(conforms(family, token)).toBe(true);
  });

  it.each([
    '',
    '10.0.0.0',
    '10.0.0.0/',
    '10.0.0.0/33',
    '10.0.0.0/08',
    'x/10.0.0.0/8',
    '10.0.0.0/00',
    '10.0.0.0/-1',
    '10.0.0.0/+8',
    '10.0.0.0/ 8',
    '10.0.0.0 /8',
    '10.0.0.0/8 ',
    '10.0.0.0/1000',
    '10.0.0.0/8/8',
    '010.0.0.0/8',
    '10.0.0/8',
    '/8',
    'abc/8',
    '2001:db8::/129',
    '2001:db8::/0128',
    'fe80::%eth0/64',
    '[2001:db8::]/32',
    '2001:db8::/1e2',
  ])('rejects %j as no CIDR block', async (token) => {
    await expect(rejection(cidr(), token)).resolves.toEqual(rejectedWith(cidrSentence));
    await expect(rejection(cidr({ version: 4 }), token)).resolves.toEqual(
      rejectedWith(cidrV4Sentence),
    );
    await expect(rejection(cidr({ version: 6 }), token)).resolves.toEqual(
      rejectedWith(cidrV6Sentence),
    );
  });

  it.each([
    '10.0.0.1/8',
    '192.0.2.1/24',
    '0.0.0.1/0',
    '10.0.0.0/6',
    '2001:db8::1/32',
    '::1/127',
    '2001:db8::8000/112',
    '::ffff:192.0.2.1/120',
  ])(
    'rejects %j, whose address has a bit set below the prefix, with its own sentence',
    async (token) => {
      await expect(rejection(cidr(), token)).resolves.toEqual(rejectedWith(hostBitsSentence));
      const family = token.includes(':') ? cidr({ version: 6 }) : cidr({ version: 4 });
      await expect(rejection(family, token)).resolves.toEqual(rejectedWith(hostBitsSentence));
    },
  );

  it("rejects a block of the other family with the family's sentence, whatever its bits", async () => {
    for (const token of ['2001:db8::/32', '2001:db8::1/32', '::ffff:192.0.2.0/120']) {
      await expect(rejection(cidr({ version: 4 }), token)).resolves.toEqual(
        rejectedWith(cidrV4Sentence),
      );
    }
    for (const token of ['10.0.0.0/8', '10.0.0.1/8']) {
      await expect(rejection(cidr({ version: 6 }), token)).resolves.toEqual(
        rejectedWith(cidrV6Sentence),
      );
    }
  });

  it('publishes a pattern of an address and a prefix from 0 through 128, for each version', () => {
    const schema = {
      $schema: dialect,
      pattern: '^[0-9A-Fa-f:.]+/(?:12[0-8]|1[01][0-9]|[1-9]?[0-9])$',
      type: 'string',
    };
    expect(published(cidr())).toEqual(schema);
    expect(published(cidr({ version: 4 }))).toEqual(schema);
    expect(published(cidr({ version: 6 }))).toEqual(schema);
  });

  it.each(['10.0.0.0/129', '10.0.0.0/08', 'x/8', '10.0.0.0', '[::]/0', '10.0.0.0/8 '])(
    'the published pattern refuses %j',
    (token) => {
      expect(conforms(cidr(), token)).toBe(false);
    },
  );
});
