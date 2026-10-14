import { describe, expect, it } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { dateTime } from '../src/index.js';
import { conforms, declarationFault, faultOf, published, verdict } from './support.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

const sentence = 'Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.';

const outsideRun =
  'This validator reads the validation context, which only exists during a Loom run. Call the validator through an Application run, or leave the context unread.';

const zoneFault =
  'dateTime() timeZone is not an IANA time zone name. Supply a name such as America/New_York.';

/** The messages a rejected token earns. The sentence's own examples may contain a short token. */
async function messagesOf(validator: Parameters<typeof verdict>[0], token: string) {
  const result = await verdict(validator, token);
  return result.issues?.map((issue) => issue.message);
}

/** The ISO instant a token reads as, or undefined when the validator rejected it. */
async function instantOf(validator: Parameters<typeof verdict>[0], token: string) {
  const result = await verdict(validator, token);
  return 'value' in result && result.value instanceof Date ? result.value.toISOString() : undefined;
}

const fixture = new URL('fixtures/date-time-run.mjs', import.meta.url);

interface Outcome {
  status: number;
  stderr: string;
  stdout: string;
}

/** The ISO instant each token reads as in a run on a host in `zone`, or its rejection's stderr. */
function readIn(zone: string, tokens: string[], options: object = {}) {
  const result = invoke(fixture, [JSON.stringify(options), zone, ...tokens]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  const records: Outcome[] = JSON.parse(result.stdout);
  return records.map((record) => (record.status === 0 ? record.stdout.trim() : record.stderr));
}

describe('a token that names its offset', () => {
  it.each([
    ['2026-09-25T14:30:00Z', '2026-09-25T14:30:00.000Z'],
    ['2026-09-25t14:30:00z', '2026-09-25T14:30:00.000Z'],
    ['2026-09-25 14:30:00Z', '2026-09-25T14:30:00.000Z'],
    ['2026-09-25T14:30Z', '2026-09-25T14:30:00.000Z'],
    ['2026-09-25T14:30:00+02:00', '2026-09-25T12:30:00.000Z'],
    ['2026-09-25 14:30-05:00', '2026-09-25T19:30:00.000Z'],
    ['2026-09-25T14:30:00+0530', '2026-09-25T09:00:00.000Z'],
    ['2026-09-25T14:30:00.5Z', '2026-09-25T14:30:00.500Z'],
    ['2026-09-25T14:30:00.123Z', '2026-09-25T14:30:00.123Z'],
    ['2026-09-25T14:30:00.123999Z', '2026-09-25T14:30:00.123Z'],
    ['2026-09-25T14:30:00.9999999999Z', '2026-09-25T14:30:00.999Z'],
    ['2024-02-29T23:59:59Z', '2024-02-29T23:59:59.000Z'],
    ['0000-01-01T00:00:00Z', '0000-01-01T00:00:00.000Z'],
    ['0099-12-31T23:59:59Z', '0099-12-31T23:59:59.000Z'],
    ['9999-12-31T23:59:59.999Z', '9999-12-31T23:59:59.999Z'],
    ['2026-01-01T00:00:00+14:00', '2025-12-31T10:00:00.000Z'],
  ])('%j is the instant %s', async (token, iso) => {
    await expect(instantOf(dateTime(), token)).resolves.toBe(iso);
    expect(conforms(dateTime(), token)).toBe(true);
  });
});

describe('a token that is not a date and time', () => {
  it.each([
    '',
    '2026-09-25',
    '2026-09-25T',
    '2026-09-25T14',
    '2026-09-25T14:3',
    '2026-09-25T24:00:00Z',
    '2026-09-25T14:60:00Z',
    '2026-09-25T14:30:60Z',
    '2026-02-29T10:00:00Z',
    '2026-13-01T10:00:00Z',
    '2026-00-10T10:00:00Z',
    '2026-04-31T10:00:00Z',
    '2026-09-25T14:30:00+24:00',
    '2026-09-25T14:30:00+05:60',
    '2026-09-25T14:30:00+5',
    '2026-09-25T14:30:00.Z',
    '2026-09-25T14:30.5Z',
    '2026-09-25  14:30:00Z',
    ' 2026-09-25T14:30:00Z',
    '2026-09-25T14:30:00Z ',
    '26-09-25T14:30:00Z',
    '20260925T143000Z',
    '2026-09-25T14:30:00 Z',
    '2026-09-25T14:30:00ZZ',
    '2026-09-25T14:30:00UTC',
    'now',
    'now+2h',
    'tomorrow',
  ])('%j is rejected with one sentence', async (token) => {
    await expect(messagesOf(dateTime({ timeZone: 'UTC' }), token)).resolves.toEqual([sentence]);
  });
});

describe('a token with no offset is read in the pinned zone, and needs no run', () => {
  it.each([
    ['UTC', '2026-09-25T14:30:00', '2026-09-25T14:30:00.000Z'],
    ['Asia/Tokyo', '2026-09-25 14:30', '2026-09-25T05:30:00.000Z'],
    ['America/New_York', '2026-09-25T14:30:00', '2026-09-25T18:30:00.000Z'],
    ['America/New_York', '2026-01-15T14:30:00.987654', '2026-01-15T19:30:00.987Z'],
    ['Asia/Kolkata', '2026-09-25T14:30:00', '2026-09-25T09:00:00.000Z'],
    ['Pacific/Chatham', '2026-01-15T14:30:00', '2026-01-15T00:45:00.000Z'],
    ['UTC', '0001-01-01T00:00:00', '0001-01-01T00:00:00.000Z'],
  ])('in %s, %j is %s', async (timeZone, token, iso) => {
    await expect(instantOf(dateTime({ timeZone }), token)).resolves.toBe(iso);
  });

  it('keeps an offset the token names over the pinned zone', async () => {
    await expect(
      instantOf(dateTime({ timeZone: 'Asia/Tokyo' }), '2026-09-25T14:30:00Z'),
    ).resolves.toBe('2026-09-25T14:30:00.000Z');
  });
});

describe('a token with no offset in a run is read in the host time zone', () => {
  it('reads the host zone, and the pinned zone replaces it', () => {
    expect(readIn('America/New_York', ['2026-09-25T14:30:00'])).toEqual([
      '2026-09-25T18:30:00.000Z',
    ]);
    expect(readIn('Asia/Tokyo', ['2026-09-25T14:30:00'])).toEqual(['2026-09-25T05:30:00.000Z']);
    expect(readIn('Asia/Tokyo', ['2026-09-25T14:30:00'], { timeZone: 'America/New_York' })).toEqual(
      ['2026-09-25T18:30:00.000Z'],
    );
  });

  it('leaves an offset the token names alone', () => {
    expect(readIn('Asia/Tokyo', ['2026-09-25T14:30:00+02:00'])).toEqual([
      '2026-09-25T12:30:00.000Z',
    ]);
  });

  it('resolves a time in a gap forward and an overlap to the earlier instant', () => {
    expect(
      readIn('America/New_York', [
        '2026-03-08T01:59:00',
        '2026-03-08T02:00:00',
        '2026-03-08T02:30:00',
        '2026-03-08T02:59:59',
        '2026-03-08T03:00:00',
        '2026-11-01T00:59:00',
        '2026-11-01T01:00:00',
        '2026-11-01T01:30:00',
        '2026-11-01T01:59:59',
        '2026-11-01T02:00:00',
      ]),
    ).toEqual([
      '2026-03-08T06:59:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T07:30:00.000Z',
      '2026-03-08T07:59:59.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-11-01T04:59:00.000Z',
      '2026-11-01T05:00:00.000Z',
      '2026-11-01T05:30:00.000Z',
      '2026-11-01T05:59:59.000Z',
      '2026-11-01T07:00:00.000Z',
    ]);
  });

  it('applies the same rules in the southern hemisphere and in Europe', () => {
    expect(readIn('Australia/Sydney', ['2026-10-04T02:30:00', '2026-04-05T02:30:00'])).toEqual([
      '2026-10-03T16:30:00.000Z',
      '2026-04-04T15:30:00.000Z',
    ]);
    expect(readIn('Europe/London', ['2026-03-29T01:30:00', '2026-10-25T01:30:00'])).toEqual([
      '2026-03-29T01:30:00.000Z',
      '2026-10-25T00:30:00.000Z',
    ]);
  });

  it('rejects a bad token with the sentence and without the token', () => {
    expect(readIn('UTC', ['2026-02-30T10:00:00'])).toEqual([`probe: Option "--at": ${sentence}\n`]);
  });
});

describe('the host time zone', () => {
  it('is read only for a token with no offset and no pinned zone', async () => {
    expect(faultOf(() => dateTime()['~standard'].validate('2026-09-25T14:30:00'))).toEqual(
      declarationFault(outsideRun),
    );
    await expect(instantOf(dateTime(), '2026-09-25T14:30:00Z')).resolves.toBe(
      '2026-09-25T14:30:00.000Z',
    );
  });
});

describe('the timeZone setting', () => {
  it.each(['Mars/Olympus', '', 'America/Nowhere', 'not a zone'])(
    'throws at the call for %j',
    (timeZone) => {
      expect(faultOf(() => dateTime({ timeZone }))).toEqual(declarationFault(zoneFault));
    },
  );

  it.each([5, null, ['UTC']])('throws at the call for %j', (timeZone) => {
    expect(faultOf(() => Reflect.apply(dateTime, undefined, [{ timeZone }]))).toEqual(
      declarationFault(zoneFault),
    );
  });
});

describe('the published schema', () => {
  it('admits both forms through a pattern, never format date-time', () => {
    const schema = published(dateTime());
    expect(schema).toEqual({
      $schema: dialect,
      pattern:
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\\.[0-9]+)?)?(?:[Zz]|[+-][0-9]{2}:?[0-9]{2})?$',
      type: 'string',
    });
    expect(published(dateTime({ timeZone: 'Asia/Tokyo' }))).toEqual(schema);
  });

  it.each([
    '2026-09-25T14:30',
    '2026-09-25 14:30:00',
    '2026-09-25T14:30:00.5',
    '2026-09-25T14:30:00Z',
    '2026-09-25t14:30:00z',
    '2026-09-25T14:30:00-0500',
    '2026-09-25T14:30:00+05:30',
  ])('the pattern admits %j, which the validator accepts', async (token) => {
    expect(conforms(dateTime(), token)).toBe(true);
    await expect(instantOf(dateTime({ timeZone: 'UTC' }), token)).resolves.toBeTypeOf('string');
  });
});
