// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { describe, expect, it } from 'vite-plus/test';

import { time } from '../src/index.js';
import { conforms, declarationFault, faultOf, published, verdict } from './support.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

const sentence = 'Expected a time of day, such as 09:30 or 17:45:30.';

/** The messages a rejected token earns. The sentence's own examples may contain a short token. */
async function messagesOf(validator: Parameters<typeof verdict>[0], token: string) {
  const result = await verdict(validator, token);
  return result.issues?.map((issue) => issue.message);
}

describe('a time of day in the default grammar', () => {
  it.each([
    ['00:00', 0],
    ['09:30', 34_200_000],
    ['17:45:30', 63_930_000],
    ['23:59', 86_340_000],
    ['23:59:59', 86_399_000],
    ['23:59:59.5', 86_399_500],
    ['23:59:59.9999', 86_399_999],
    ['12:00:00.123', 43_200_123],
    ['00:00:00.000999', 0],
    ['08:05:07.04', 29_107_040],
  ])('%j is %i milliseconds since midnight', async (token, value) => {
    await expect(verdict(time(), token)).resolves.toEqual({ value });
    expect(conforms(time(), token)).toBe(true);
  });

  it.each([
    '',
    '9:30',
    '09:3',
    '0930',
    '09',
    '24:00',
    '24:00:00',
    '23:60',
    '23:59:60',
    '09:30Z',
    '09:30+02:00',
    '09:30:00Z',
    '09:30.5',
    '09:30:00.',
    '09:30:',
    ' 09:30',
    '09:30 ',
    '9:30pm',
    '09:30:5',
    '١٢:30',
    'noon',
  ])('rejects %j with one sentence', async (token) => {
    await expect(messagesOf(time(), token)).resolves.toEqual([sentence]);
  });

  it('publishes the default grammar whole as a pattern, never format time', () => {
    expect(published(time())).toEqual({
      $schema: dialect,
      pattern: String.raw`^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]+)?)?$`,
      type: 'string',
    });
  });
});

describe('bounds in the default grammar', () => {
  it.each([
    [{ max: '17:00', min: '09:00' }, '09:00', 32_400_000],
    [{ max: '17:00', min: '09:00' }, '17:00', 61_200_000],
    [{ max: '17:00', min: '09:00' }, '12:30:15.25', 45_015_250],
    [{ min: '09:00' }, '23:59:59.999', 86_399_999],
    [{ max: '17:00' }, '00:00', 0],
    [{ max: '09:00:00.5', min: '09:00:00.5' }, '09:00:00.5000', 32_400_500],
  ])('%j accepts %j as %i', async (bounds, token, value) => {
    await expect(verdict(time(bounds), token)).resolves.toEqual({ value });
  });

  it.each([
    [{ max: '17:00', min: '09:00' }, '08:59:59.999', 'Expected a time from 09:00 through 17:00.'],
    [{ max: '17:00', min: '09:00' }, '17:00:00.001', 'Expected a time from 09:00 through 17:00.'],
    [{ max: '17:00', min: '09:00' }, 'nope', 'Expected a time from 09:00 through 17:00.'],
    [{ min: '09:00' }, '08:00', 'Expected a time of at least 09:00.'],
    [{ max: '17:00' }, '18:00', 'Expected a time of at most 17:00.'],
    [{ max: '17:00' }, '24:00', 'Expected a time of at most 17:00.'],
    [{ min: '09:00:30' }, '09:00', 'Expected a time of at least 09:00:30.'],
    [{ min: '09:00:00.50' }, '09:00', 'Expected a time of at least 09:00:00.5.'],
    [{ min: '09:00:00.012' }, '09:00', 'Expected a time of at least 09:00:00.012.'],
    [{ min: '00:00:00.0000' }, '24:00', 'Expected a time of at least 00:00.'],
    [{ max: '23:59:59.9999' }, '9:30', 'Expected a time of at most 23:59:59.999.'],
  ])('%j rejects %j with the bounds sentence', async (bounds, token, message) => {
    await expect(messagesOf(time(bounds), token)).resolves.toEqual([message]);
  });

  it.each([
    ['min', '9:00'],
    ['max', '24:00'],
    ['min', '09:00Z'],
    ['max', ''],
    ['min', '9am'],
  ])('throws at the call for a %s of %j', (name, bound) => {
    expect(faultOf(() => time({ [name]: bound }))).toEqual(
      declarationFault(
        `time() ${name} is not a time of day. Supply a time of day such as "09:00" or "17:30".`,
      ),
    );
  });

  it('throws at the call for a min above max, and accepts equal bounds', () => {
    expect(faultOf(() => time({ max: '09:00', min: '17:00:30' }))).toEqual(
      declarationFault('time() min 17:00:30 is above max 09:00. Supply a min at or below max.'),
    );
    expect(faultOf(() => time({ max: '09:00', min: '09:00' }))).toBeUndefined();
  });

  it('publishes the same pattern, because a pattern cannot carry the bounds', () => {
    expect(published(time({ max: '17:00', min: '09:00' }))).toEqual(published(time()));
  });
});

describe('time layouts', () => {
  const twelveHour = ['%I:%M%p'] as const;

  it.each([
    [twelveHour, '9:30pm', 77_400_000],
    [twelveHour, '9:30PM', 77_400_000],
    [twelveHour, '09:30Pm', 77_400_000],
    [twelveHour, '9:30aM', 34_200_000],
    [twelveHour, '12:00AM', 0],
    [twelveHour, '12:30am', 1_800_000],
    [twelveHour, '12:00PM', 43_200_000],
    [twelveHour, '11:59pm', 86_340_000],
    [twelveHour, '1:5am', 3_900_000],
    [twelveHour, '09:30', 34_200_000],
    [['%I:%M:%S %p'], '11:59:59 PM', 86_399_000],
    [['%H%M'], '0930', 34_200_000],
    [['%H%M%S'], '093015', 34_215_000],
    [['%H%M%S'], '09305', 34_205_000],
    [['%H.%M.%S'], '9.30.15', 34_215_000],
    [['%Hh%M'], '9h30', 34_200_000],
    [['%H-%M'], '23-59', 86_340_000],
    [['%H%%%M'], '9%30', 34_200_000],
  ] as const)('%j reads %j as %i', async (layouts, token, value) => {
    await expect(verdict(time({ layouts }), token)).resolves.toEqual({ value });
    expect(conforms(time({ layouts }), token)).toBe(true);
  });

  const twelveHourSentence = 'Expected a time of day as hh:mm or hh:mmAM, such as 09:30.';

  it.each([
    '13:00PM',
    '0:30AM',
    '00:30am',
    '9:30',
    '9:60pm',
    '9:30 pm',
    '9:30p',
    '9:30pmZ',
    '9:30a.m.',
    '930pm',
  ])('%j is rejected with every form', async (token) => {
    await expect(messagesOf(time({ layouts: twelveHour }), token)).resolves.toEqual([
      twelveHourSentence,
    ]);
  });

  it.each([
    [['%H:%M'], 'Expected a time of day as hh:mm, such as 09:30.'],
    [['%I:%M%p', '%H.%M'], 'Expected a time of day as hh:mm, hh:mmAM, or hh.mm, such as 09:30.'],
    [
      ['%I:%M %p', '%H:%M:%S'],
      'Expected a time of day as hh:mm, hh:mm AM, or hh:mm:ss, such as 09:30.',
    ],
  ] as const)('%j writes its forms once each, in order', async (layouts, message) => {
    await expect(messagesOf(time({ layouts }), 'nope')).resolves.toEqual([message]);
  });

  it.each([
    [['%H%M'], '930'],
    [['%H%M'], '09305'],
    [['%H%M'], '2400'],
  ] as const)('%j rejects %j', async (layouts, token) => {
    await expect(messagesOf(time({ layouts }), token)).resolves.toEqual([
      'Expected a time of day as hh:mm or hhmm, such as 09:30.',
    ]);
  });

  it('answers the bounds sentence alone, whatever the layouts, and bounds a layout reading', async () => {
    const office = time({ layouts: twelveHour, max: '17:00', min: '09:00' });
    await expect(verdict(office, '9:00am')).resolves.toEqual({ value: 32_400_000 });
    await expect(verdict(office, '5:00PM')).resolves.toEqual({ value: 61_200_000 });
    await expect(messagesOf(office, '8:59am')).resolves.toEqual([
      'Expected a time from 09:00 through 17:00.',
    ]);
    await expect(messagesOf(office, 'nope')).resolves.toEqual([
      'Expected a time from 09:00 through 17:00.',
    ]);
    await expect(
      messagesOf(time({ layouts: twelveHour, min: '09:00' }), '5:00am'),
    ).resolves.toEqual(['Expected a time of at least 09:00.']);
  });

  it('publishes the default pattern, then a pattern for each layout', () => {
    expect(published(time({ layouts: ['%I:%M%p', '%H%M%S', '%H.%M'] }))).toEqual({
      $schema: dialect,
      anyOf: [
        { pattern: String.raw`^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]+)?)?$` },
        { pattern: '^[0-9]{1,2}:[0-9]{1,2}[AaPp][Mm]$' },
        { pattern: '^[0-9]{2}[0-9]{2}[0-9]{1,2}$' },
        { pattern: String.raw`^[0-9]{1,2}\.[0-9]{1,2}$` },
      ],
      type: 'string',
    });
  });
});
