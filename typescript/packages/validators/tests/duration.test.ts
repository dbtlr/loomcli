// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { describe, expect, it } from 'vite-plus/test';

import { duration } from '../src/index.js';
import { conforms, declarationFault, faultOf, published, verdict } from './support.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

const sentence = 'Expected a duration, such as 90s, 2h30m, or 1.5h.';

const capitalMSentence = 'Expected a duration; write minutes as m or min, because M is ambiguous.';

/** The messages a rejected token earns. The sentence's own examples may contain a short token. */
async function messagesOf(validator: Parameters<typeof verdict>[0], token: string) {
  const result = await verdict(validator, token);
  return result.issues?.map((issue) => issue.message);
}

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;
const week = 7 * day;

describe('a duration token', () => {
  it.each([
    ['90s', 90 * second],
    ['2h30m', 2 * hour + 30 * minute],
    ['1.5h', 1.5 * hour],
    ['7d', week],
    ['1w', week],
    ['500ms', 500],
    ['0s', 0],
    ['0', 0],
    ['30', 30 * second],
    ['1.5', 1500],
    ['.5', 500],
    ['.5s', 500],
    ['1.s', second],
    ['0.1s', 100],
    ['1.1s', 1100],
    ['2.3h', 8_280_000],
    ['0.5ms', 0.5],
    ['30m2h', 2 * hour + 30 * minute],
    ['1h1h', 2 * hour],
    ['1m1s1ms', minute + second + 1],
    ['1w2d3h4m5s6ms', week + 2 * day + 3 * hour + 4 * minute + 5 * second + 6],
    ['0001s', second],
    ['007', 7 * second],
  ])('%j is %d milliseconds', async (token, milliseconds) => {
    await expect(verdict(duration(), token)).resolves.toEqual({ value: milliseconds });
    expect(conforms(duration(), token)).toBe(true);
  });
});

describe('systemd spellings and spacing', () => {
  it.each([
    ['250msec', 250],
    ['5 sec', 5 * second],
    ['90 sec', 90 * second],
    ['1 second', second],
    ['2 seconds', 2 * second],
    ['3min', 3 * minute],
    ['3 minute', 3 * minute],
    ['4 minutes', 4 * minute],
    ['1hr', hour],
    ['1 hour', hour],
    ['2 hours', 2 * hour],
    ['2hr', 2 * hour],
    ['1day', day],
    ['1 day', day],
    ['3 days', 3 * day],
    ['1week', week],
    ['2 weeks', 2 * week],
    ['1h 30m', hour + 30 * minute],
    ['1 hour 30 min', hour + 30 * minute],
    ['1h  30m', hour + 30 * minute],
    ['1.5 hours', 1.5 * hour],
    ['30m 2h', 2 * hour + 30 * minute],
    ['1 d 2 h', day + 2 * hour],
    ['1 \t h', hour],
    [' 1h', hour],
    ['1h ', hour],
    ['  1 hour 30 min  ', hour + 30 * minute],
    [' 30 ', 30 * second],
    ['1 ms', 1],
  ])('%j is %d milliseconds', async (token, milliseconds) => {
    await expect(verdict(duration(), token)).resolves.toEqual({ value: milliseconds });
    expect(conforms(duration(), token)).toBe(true);
  });
});

describe('a capital M', () => {
  it.each(['5M', '1 M', '1h 5M', '2h30M', ' 5M ', '1.5M'])(
    '%j is rejected as ambiguous, naming m and min',
    async (token) => {
      await expect(messagesOf(duration(), token)).resolves.toEqual([capitalMSentence]);
      await expect(messagesOf(duration({ max: '1h', min: '1s' }), token)).resolves.toEqual([
        capitalMSentence,
      ]);
    },
  );

  it.each(['M', '5Ms', '5MS', '5 Min', '5Month', '5M5', '5M x'])(
    '%j is only not a duration',
    async (token) => {
      await expect(messagesOf(duration(), token)).resolves.toEqual([sentence]);
    },
  );
});

describe('a token that is not a duration', () => {
  it.each([
    '',
    '-1s',
    '+1s',
    '1 2h',
    '1h 30',
    '1 h 30',
    '1h, 30m',
    '1h and 30m',
    '5 mon',
    '1 month',
    '2 months',
    '1 year',
    '2 years',
    '1 y',
    '1 Hour',
    '1 Day',
    '1 Sec',
    '1 hours30',
    '1 hr.',
    '5 minuts',
    '- 1s',
    '1H',
    '1S',
    '1MS',
    '2x',
    'h',
    's',
    '.',
    '1.5.2s',
    '1h30',
    '1h30m5',
    'abc',
    '1e3s',
    '1_0s',
    '1,5h',
    'PT1H',
    '1mo',
    '1y',
    '1month',
    '1year',
    '1µs',
    '1ns',
    '9999999999999999999w',
    '9'.repeat(400),
  ])('%j is rejected with one sentence', async (token) => {
    await expect(messagesOf(duration(), token)).resolves.toEqual([sentence]);
  });
});

describe('the min and max settings', () => {
  it('accepts both bounds themselves and what lies between', async () => {
    const validator = duration({ max: '24h', min: '30' });
    await expect(verdict(validator, '30')).resolves.toEqual({ value: 30 * second });
    await expect(verdict(validator, '30s')).resolves.toEqual({ value: 30 * second });
    await expect(verdict(validator, '1h')).resolves.toEqual({ value: hour });
    await expect(verdict(validator, '24h')).resolves.toEqual({ value: day });
    await expect(verdict(validator, '1d')).resolves.toEqual({ value: day });
  });

  it('reads a bound written in the long forms', async () => {
    const validator = duration({ max: '1 day', min: '30 seconds' });
    await expect(verdict(validator, '30s')).resolves.toEqual({ value: 30 * second });
    await expect(verdict(validator, '24 hours')).resolves.toEqual({ value: day });
    const range = ['Expected a duration from 30s through 1d.'];
    await expect(messagesOf(validator, '29 sec')).resolves.toEqual(range);
    await expect(messagesOf(validator, '1 day 1 ms')).resolves.toEqual(range);
    await expect(verdict(duration({ max: '1 hour 30 min' }), '90m')).resolves.toEqual({
      value: 90 * minute,
    });
  });

  it('rejects a duration outside the bounds with the range sentence', async () => {
    const validator = duration({ max: '24h', min: '30' });
    const range = ['Expected a duration from 30s through 1d.'];
    await expect(messagesOf(validator, '29s')).resolves.toEqual(range);
    await expect(messagesOf(validator, '29999ms')).resolves.toEqual(range);
    await expect(messagesOf(validator, '24h1ms')).resolves.toEqual(range);
    await expect(messagesOf(validator, '25h')).resolves.toEqual(range);
    await expect(messagesOf(validator, 'abc')).resolves.toEqual(range);
  });

  it('states a lone lower bound and a lone upper bound in their own sentences', async () => {
    await expect(messagesOf(duration({ min: '1h30m' }), '1h')).resolves.toEqual([
      'Expected a duration of at least 1h30m.',
    ]);
    await expect(messagesOf(duration({ max: '250ms' }), '1s')).resolves.toEqual([
      'Expected a duration of at most 250ms.',
    ]);
    await expect(verdict(duration({ min: '0' }), '0')).resolves.toEqual({ value: 0 });
  });

  it('reads a bound in the operator grammar, units in any order', async () => {
    const validator = duration({ min: '30m2h' });
    await expect(verdict(validator, '2h30m')).resolves.toEqual({ value: 2 * hour + 30 * minute });
    await expect(verdict(validator, '2h29m')).resolves.toHaveProperty('issues');
  });

  it.each([
    ['abc', 'min'],
    ['', 'min'],
    ['-1s', 'min'],
    ['1 H', 'min'],
    ['1H', 'min'],
    ['5M', 'min'],
    ['1 month', 'max'],
    ['9'.repeat(400), 'min'],
    ['abc', 'max'],
    ['1h30', 'max'],
  ] as const)('throws at the call for the bound %j on %s', (bound, name) => {
    expect(faultOf(() => duration({ [name]: bound }))).toEqual(
      declarationFault(
        `duration() ${name} is not a duration. Supply a duration such as "30s" or "2h30m".`,
      ),
    );
  });

  it('throws at the call for a min above max', () => {
    expect(faultOf(() => duration({ max: '30s', min: '1h' }))).toEqual(
      declarationFault('duration() min 1h is above max 30s. Supply a min at or below max.'),
    );
    expect(faultOf(() => duration({ max: '1h', min: '1h' }))).toBeUndefined();
  });
});

describe('the published schema', () => {
  const number = String.raw`(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)`;
  const unit =
    '(?:minutes|seconds|minute|second|hours|weeks|days|hour|msec|week|day|min|sec|hr|ms|d|h|m|s|w)';
  const pattern = String.raw`^\s*${number}(?:\s*${unit}(?:\s*${number}\s*${unit})*)?\s*$`;

  it('is a pattern for the grammar, with or without bounds', () => {
    const schema = { $schema: dialect, pattern, type: 'string' };
    expect(published(duration())).toEqual(schema);
    expect(published(duration({ max: '24h', min: '30' }))).toEqual(schema);
  });

  it.each([
    '30',
    '.5',
    '1.',
    '90s',
    '1ms',
    '1m1s',
    '2h30m',
    '1w2d3h4m5s6ms',
    '1 hour 30 min',
    ' 2 weeks ',
    '250msec',
  ])('admits %j', (token) => {
    expect(conforms(duration(), token)).toBe(true);
  });

  it.each(['', '-1s', '1H', '1h30', 's', '1y', '1 month', '5M', '1 2h', '1h and 30m'])(
    'refuses %j',
    (token) => {
      expect(conforms(duration(), token)).toBe(false);
    },
  );
});
