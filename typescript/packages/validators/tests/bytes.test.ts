// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { describe, expect, it } from 'vite-plus/test';

import { bytes } from '../src/index.js';
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

const sentence = 'Expected a size, such as 512KiB, 10MB, or 1.5GB.';

// Whitespace that String.prototype.trim removes beyond ASCII, written by code point so it stays visible.
const noBreakSpace = String.fromCodePoint(0xa0);
const byteOrderMark = String.fromCodePoint(0xfe_ff);
const emSpace = String.fromCodePoint(0x20_03);

/** The messages a rejected token earns, for a token the sentence's own examples contain. */
async function messagesOf(validator: Parameters<typeof verdict>[0], token: string) {
  const result = await verdict(validator, token);
  return result.issues?.map((issue) => issue.message);
}

describe('a size token reads as a whole number of bytes and satisfies the published schema', () => {
  it.each([
    ['512', 512],
    ['0', 0],
    ['007', 7],
    ['0B', 0],
    ['1B', 1],
    ['1.000B', 1],
    ['1kB', 1000],
    ['1KB', 1000],
    ['10MB', 10_000_000],
    ['1.5GB', 1_500_000_000],
    ['1.5 GB', 1_500_000_000],
    ['2.01kB', 2010],
    ['0.001kB', 1],
    ['1TB', 1_000_000_000_000],
    ['1PB', 1_000_000_000_000_000],
    ['1KiB', 1024],
    ['1Ki', 1024],
    ['.5KiB', 512],
    ['0.5KiB', 512],
    ['1.KiB', 1024],
    ['1.25KiB', 1280],
    ['512Mi', 536_870_912],
    ['512MiB', 536_870_912],
    ['1GiB', 1_073_741_824],
    ['1Gi', 1_073_741_824],
    ['1TiB', 1_099_511_627_776],
    ['1Ti', 1_099_511_627_776],
    ['1PiB', 1_125_899_906_842_624],
    ['1Pi', 1_125_899_906_842_624],
    ['7PiB', 7_881_299_347_898_368],
    ['9007199254740991', 9_007_199_254_740_991],
    [' 10MB ', 10_000_000],
    ['10 MB', 10_000_000],
    ['10\tMB', 10_000_000],
    ['\n10MB\r\n', 10_000_000],
    [`${noBreakSpace}10MB${noBreakSpace}`, 10_000_000],
    [`${byteOrderMark}10MB`, 10_000_000],
    [`10 ${emSpace} MB`, 10_000_000],
  ])('%j is %d bytes', async (token, count) => {
    await expect(verdict(bytes(), token)).resolves.toEqual({ value: count });
    expect(conforms(bytes(), token)).toBe(true);
  });
});

describe('a token that is not a size', () => {
  it.each([
    '',
    'abc',
    '10K',
    '10k',
    '10G',
    '1kiB',
    '1KIB',
    '1mb',
    '1Mb',
    '1kb',
    '1gB',
    '1b',
    '1iB',
    '1Bi',
    '1EB',
    '1EiB',
    '1GB 500MB',
    '1GB500MB',
    '1 0MB',
    '-1',
    '+1',
    '-1MB',
    '2.5B',
    '0.1KiB',
    '0.0001kB',
    '8PiB',
    '9PiB',
    '9007199254740992',
    '9'.repeat(400),
    '1e3',
    '1_000',
    '1,5GB',
    '.MB',
    '1..5MB',
    '1.5.2MB',
    '1 kB B',
    '1 B B',
    '0x10',
    '１MB',
    '10MB\nx',
    '1.5B',
  ])('%j is rejected with one sentence that never repeats it', async (token) => {
    await expect(rejection(bytes(), token)).resolves.toEqual(rejectedWith(sentence));
  });

  it.each([' ', '.', '.5', 'B', 'KiB', 'MB', '10M', '1.5'])(
    '%j, which the sentence happens to contain, is rejected with the same sentence',
    async (token) => {
      await expect(messagesOf(bytes(), token)).resolves.toEqual([sentence]);
    },
  );
});

describe('the min and max settings', () => {
  it('accepts both bounds themselves and what lies between, in any spelling', async () => {
    const validator = bytes({ max: '10GiB', min: '1MB' });
    await expect(verdict(validator, '1MB')).resolves.toEqual({ value: 1_000_000 });
    await expect(verdict(validator, '1000kB')).resolves.toEqual({ value: 1_000_000 });
    await expect(verdict(validator, '1000000')).resolves.toEqual({ value: 1_000_000 });
    await expect(verdict(validator, '10GiB')).resolves.toEqual({ value: 10_737_418_240 });
    await expect(verdict(validator, '10240Mi')).resolves.toEqual({ value: 10_737_418_240 });
  });

  it('rejects a size outside the bounds, and a token outside the grammar, with the range sentence', async () => {
    const validator = bytes({ max: '10GiB', min: '1MB' });
    const range = rejectedWith('Expected a size from 1MB through 10GiB.');
    await expect(rejection(validator, '999999')).resolves.toEqual(range);
    await expect(rejection(validator, '10737418241')).resolves.toEqual(range);
    await expect(rejection(validator, '11GiB')).resolves.toEqual(range);
    await expect(rejection(validator, 'abc')).resolves.toEqual(range);
    await expect(rejection(validator, '10M')).resolves.toEqual(range);
  });

  it('states a lone lower bound and a lone upper bound in their own sentences', async () => {
    await expect(rejection(bytes({ min: '1MB' }), '1kB')).resolves.toEqual(
      rejectedWith('Expected a size of at least 1MB.'),
    );
    await expect(rejection(bytes({ max: '10GiB' }), '11GiB')).resolves.toEqual(
      rejectedWith('Expected a size of at most 10GiB.'),
    );
    await expect(verdict(bytes({ min: '0' }), '0')).resolves.toEqual({ value: 0 });
  });

  it.each([
    ['1048576', '1MiB'],
    ['1MiB', '1MiB'],
    ['1000000', '1MB'],
    ['1000', '1kB'],
    ['1KB', '1kB'],
    ['1500', '1500B'],
    ['1.5KiB', '1536B'],
    ['2KiB', '2KiB'],
    ['1024000', '1024kB'],
    ['1000KiB', '1024kB'],
    ['1.5GB', '1500MB'],
    ['7PiB', '7PiB'],
    ['1PB', '1PB'],
    ['9007199254740991', '9007199254740991B'],
  ])('the bound %j prints as %s', async (bound, printed) => {
    await expect(rejection(bytes({ max: bound }), '8PiB')).resolves.toEqual(
      rejectedWith(`Expected a size of at most ${printed}.`),
    );
  });

  it('prints a bound of 0 as 0B', async () => {
    await expect(rejection(bytes({ max: '0KiB' }), '1')).resolves.toEqual(
      rejectedWith('Expected a size of at most 0B.'),
    );
  });

  it.each([
    ['10M', 'min'],
    ['1.5B', 'min'],
    ['9PiB', 'max'],
    ['8PiB', 'max'],
    ['abc', 'min'],
    ['', 'max'],
    ['-1', 'min'],
    ['1kiB', 'max'],
    ['1GB 500MB', 'max'],
  ] as const)('throws at the call for the bound %j on %s', (bound, name) => {
    expect(faultOf(() => bytes({ [name]: bound }))).toEqual(
      declarationFault(`bytes() ${name} is not a size. Supply a size such as "1MB" or "10GiB".`),
    );
  });

  it('throws at the call for a min above max', () => {
    expect(faultOf(() => bytes({ max: '1MB', min: '10GiB' }))).toEqual(
      declarationFault('bytes() min 10GiB is above max 1MB. Supply a min at or below max.'),
    );
    expect(faultOf(() => bytes({ max: '1000kB', min: '1MB' }))).toBeUndefined();
  });
});

describe('the published schema', () => {
  const number = String.raw`(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)`;
  const unit = '(?:KiB|MiB|GiB|TiB|PiB|Ki|Mi|Gi|Ti|Pi|[kK]B|MB|GB|TB|PB|B)';
  const pattern = String.raw`^\s*${number}\s*${unit}?\s*$`;

  it('is a pattern for the grammar, with or without bounds', () => {
    const schema = { $schema: dialect, pattern, type: 'string' };
    expect(published(bytes())).toEqual(schema);
    expect(published(bytes({ max: '10GiB', min: '1MB' }))).toEqual(schema);
  });

  it.each(['', '10M', '1kiB', '1mb', '-1', '1GB 500MB', 'abc', '1e3'])('refuses %j', (token) => {
    expect(conforms(bytes(), token)).toBe(false);
  });
});
