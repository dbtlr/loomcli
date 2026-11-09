// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { validationOptions } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { describe, expect, it } from 'vite-plus/test';

import { date, dateTime, time } from '../src/index.js';
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

describe('date layouts', () => {
  const accepted: [readonly [string, ...string[]], string, string][] = [
    [['%d/%m/%Y'], '25/09/2026', '2026-09-25'],
    [['%d/%m/%Y'], '25/9/2026', '2026-09-25'],
    [['%d/%m/%Y'], '5/09/2026', '2026-09-05'],
    [['%d/%m/%Y'], '05/9/2026', '2026-09-05'],
    [['%d/%m/%Y'], '29/02/2024', '2024-02-29'],
    [['%d/%m/%Y'], '1/1/0000', '0000-01-01'],
    [['%d/%m/%Y'], '2026-09-25', '2026-09-25'],
    [['%Y%m%d'], '20260304', '2026-03-04'],
    [['%Y%m%d'], '2026034', '2026-03-04'],
    [['%d/%m/%Y', '%m/%d/%Y'], '03/04/2026', '2026-04-03'],
    [['%d/%m/%Y', '%m/%d/%Y'], '03/25/2026', '2026-03-25'],
    [['%m/%d/%Y', '%d/%m/%Y'], '03/04/2026', '2026-03-04'],
    [['%d-%m-%Y'], '25-09-2026', '2026-09-25'],
    [['%Y-%d-%m'], '2026-03-04', '2026-03-04'],
    [['%Y-%d-%m'], '2026-25-09', '2026-09-25'],
    [['%Y%%%m%%%d'], '2026%09%25', '2026-09-25'],
    [['%d.%m.%Y'], '25.09.2026', '2026-09-25'],
    [['(%Y) [%m] {%d}'], '(2026) [09] {25}', '2026-09-25'],
    [['%Y|%m|%d'], '2026|9|25', '2026-09-25'],
    [['%Y+%m*%d?'], '2026+9*25?', '2026-09-25'],
    [[String.raw`^%Y$%m\%d`], String.raw`^2026$09\25`, '2026-09-25'],
    [['%Y/%m/%d', '%d %m %Y'], '25 09 2026', '2026-09-25'],
    [['%Y年%m月%d日'], '2026年9月25日', '2026-09-25'],
  ];

  it.each(accepted)('%j reads %j as %j', async (layouts, token, value) => {
    await expect(verdict(date({ layouts }), token)).resolves.toEqual({ value });
    expect(conforms(date({ layouts }), token)).toBe(true);
  });

  const twoForms = 'Expected a date as YYYY-MM-DD or DD/MM/YYYY, such as 2026-09-25.';

  it.each([
    '29/02/2026',
    '31/04/2026',
    '25/13/2026',
    '00/09/2026',
    '25/00/2026',
    '025/09/2026',
    '25/09/26',
    '25/09/02026',
    ' 25/09/2026',
    '25/09/2026 ',
    '25-09-2026',
    '2026/09/25',
    '25/09/2026T00:00',
    '٢٥/09/2026',
  ])('%j is rejected with every form', async (token) => {
    await expect(rejection(date({ layouts: ['%d/%m/%Y'] }), token)).resolves.toEqual(
      rejectedWith(twoForms),
    );
  });

  it.each([
    [['%d.%m.%Y'], '25x09x2026'],
    [['%Y%m%d'], '202634'],
    [['%Y%m%d'], '202613011'],
    [['%Y%%%m%%%d'], '2026%%09%25'],
  ] as const)('%j rejects %j', async (layouts, token) => {
    const result = await verdict(date({ layouts }), token);
    expect(result.issues).toHaveLength(1);
  });

  it.each([
    [['%Y-%m-%d'], 'Expected a date as YYYY-MM-DD, such as 2026-09-25.'],
    [
      ['%d/%m/%Y', '%Y%m%d'],
      'Expected a date as YYYY-MM-DD, DD/MM/YYYY, or YYYYMMDD, such as 2026-09-25.',
    ],
    [['%d/%m/%Y', '%d/%m/%Y'], twoForms],
    [['%d%%%m%%%Y'], 'Expected a date as YYYY-MM-DD or DD%MM%YYYY, such as 2026-09-25.'],
  ] as const)('%j writes its forms once each, in order', async (layouts, message) => {
    await expect(rejection(date({ layouts }), 'nope')).resolves.toEqual(rejectedWith(message));
  });

  it('publishes the date format, then a pattern for each layout', () => {
    expect(published(date({ layouts: ['%d/%m/%Y', '%Y%m%d', '%d.%m.%Y', '%Y%%%m-%d'] }))).toEqual({
      $schema: dialect,
      anyOf: [
        { format: 'date' },
        { pattern: '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' },
        { pattern: '^[0-9]{4}[0-9]{2}[0-9]{1,2}$' },
        { pattern: String.raw`^[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4}$` },
        { pattern: '^[0-9]{4}%[0-9]{1,2}-[0-9]{1,2}$' },
      ],
      type: 'string',
    });
  });

  it('escapes each syntax character of a literal in its pattern', () => {
    expect(published(date({ layouts: [String.raw`^$\.*+?()[]{}|-%Y%m%d`] }))).toEqual({
      $schema: dialect,
      anyOf: [
        { format: 'date' },
        { pattern: String.raw`^\^\$\\\.\*\+\?\(\)\[\]\{\}\|-[0-9]{4}[0-9]{2}[0-9]{1,2}$` },
      ],
      type: 'string',
    });
    expect(
      conforms(
        date({ layouts: [String.raw`^$\.*+?()[]{}|-%Y%m%d`] }),
        String.raw`^$\.*+?()[]{}|-20260925`,
      ),
    ).toBe(true);
  });
});

/** The ISO instant a token reads as, or undefined when the validator rejected it. */
async function instantOf(validator: Parameters<typeof verdict>[0], token: string) {
  const result = await verdict(validator, token);
  return 'value' in result && result.value instanceof Date ? result.value.toISOString() : undefined;
}

/** The ISO instant each token reads as in a run on a host in `zone`, or its rejection's messages. */
function readIn(zone: string, layouts: readonly [string, ...string[]], tokens: string[]) {
  const validator = dateTime({ layouts })['~standard'];
  const mock = mockProcess({ timeZone: zone });
  return Promise.all(
    tokens.map(async (token) => {
      const result = await validator.validate(
        token,
        validationOptions(mock, {
          input: { global: false, kind: 'option', name: 'at' },
          phase: 'invocation',
        }),
      );
      return result.issues === undefined
        ? result.value.toISOString()
        : result.issues.map((issue) => issue.message);
    }),
  );
}

describe('dateTime layouts', () => {
  const stamp = '%Y%m%dT%H%M%S%z';

  it('falls through to the next layout when an offset is out of range', async () => {
    const validator = dateTime({
      layouts: ['%d/%m/%Y %H:%M%z', '%d/%m/%Y %H:%M-%S'],
      timeZone: 'UTC',
    });
    await expect(instantOf(validator, '25/09/2026 14:30-59')).resolves.toBe(
      '2026-09-25T14:30:59.000Z',
    );
  });

  it.each([
    [[stamp], '20260925T143000Z', '2026-09-25T14:30:00.000Z'],
    [[stamp], '20260925T143000z', '2026-09-25T14:30:00.000Z'],
    [[stamp], '20260925T143000+0200', '2026-09-25T12:30:00.000Z'],
    [[stamp], '20260925T143000-05:30', '2026-09-25T20:00:00.000Z'],
    [[stamp], '20260925T143000+05', '2026-09-25T09:30:00.000Z'],
    [[stamp], '20260925T143000+23:59', '2026-09-24T14:31:00.000Z'],
    [['%d/%m/%Y %H:%M %z'], '25/9/2026 9:05 +01:00', '2026-09-25T08:05:00.000Z'],
    [['%d/%m/%Y %H:%M'], '2026-09-25T14:30:00Z', '2026-09-25T14:30:00.000Z'],
  ] as const)('%j reads %j as the instant %s', async (layouts, token, iso) => {
    await expect(instantOf(dateTime({ layouts }), token)).resolves.toBe(iso);
    expect(conforms(dateTime({ layouts }), token)).toBe(true);
  });

  it.each([
    ['UTC', '25/09/2026 14:30', '2026-09-25T14:30:00.000Z'],
    ['Asia/Tokyo', '25/09/2026 14:30', '2026-09-25T05:30:00.000Z'],
    ['America/New_York', '1/2/2026 9:05', '2026-02-01T14:05:00.000Z'],
  ])('in %s, a layout without %%z reads %j as %s', async (timeZone, token, iso) => {
    await expect(
      instantOf(dateTime({ layouts: ['%d/%m/%Y %H:%M'], timeZone }), token),
    ).resolves.toBe(iso);
    expect(conforms(dateTime({ layouts: ['%d/%m/%Y %H:%M'] }), token)).toBe(true);
  });

  it('reads a layout without %z in the host zone, across a gap and an overlap as the default grammar does', async () => {
    const tokens = [
      '03/08/2026 01:59:00',
      '03/08/2026 02:30:00',
      '03/08/2026 03:00:00',
      '11/01/2026 01:30:00',
      '11/01/2026 02:00:00',
    ];
    const expected = [
      '2026-03-08T06:59:00.000Z',
      '2026-03-08T07:30:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-11-01T05:30:00.000Z',
      '2026-11-01T07:00:00.000Z',
    ];
    await expect(readIn('America/New_York', ['%m/%d/%Y %H:%M:%S'], tokens)).resolves.toEqual(
      expected,
    );
    const isoTokens = tokens.map((token) => {
      const [month, day, year, clock] = token.split(/[/ ]/u);
      return `${year ?? ''}-${month ?? ''}-${day ?? ''}T${clock ?? ''}`;
    });
    await expect(readIn('America/New_York', [stamp], isoTokens)).resolves.toEqual(expected);
  });

  const forms =
    'Expected a date and time as YYYY-MM-DDThh:mm or YYYYMMDDThhmmss±hh:mm, such as 2026-09-25T14:30:00Z.';

  it.each([
    '20260925T143000',
    '20260925T143000+24',
    '20260925T143000+05:60',
    '20260925T143000+5',
    '20260925T143000+05:0',
    '20260925T243000Z',
    '20260925T146000Z',
    '20260925T143060Z',
    '20260229T143000Z',
    '20260925 143000Z',
    '20260925T143000ZZ',
    '20260925T143000UTC',
  ])('%j is rejected with every form', async (token) => {
    await expect(rejection(dateTime({ layouts: [stamp] }), token)).resolves.toEqual(
      rejectedWith(forms),
    );
  });

  it.each([
    [
      ['%d/%m/%Y %H:%M'],
      'Expected a date and time as YYYY-MM-DDThh:mm or DD/MM/YYYY hh:mm, such as 2026-09-25T14:30:00Z.',
    ],
    [
      ['%Y-%m-%dT%H:%M'],
      'Expected a date and time as YYYY-MM-DDThh:mm, such as 2026-09-25T14:30:00Z.',
    ],
    [
      ['%d/%m/%Y %H:%M', '%d.%m.%Y %H:%M:%S', '%d/%m/%Y %H:%M'],
      'Expected a date and time as YYYY-MM-DDThh:mm, DD/MM/YYYY hh:mm, or DD.MM.YYYY hh:mm:ss, such as 2026-09-25T14:30:00Z.',
    ],
  ] as const)('%j writes its forms once each, in order', async (layouts, message) => {
    await expect(rejection(dateTime({ layouts, timeZone: 'UTC' }), 'nope')).resolves.toEqual(
      rejectedWith(message),
    );
  });

  it('publishes its default pattern, then a pattern for each layout', () => {
    expect(published(dateTime({ layouts: [stamp, '%d/%m/%Y %H:%M'] }))).toEqual({
      $schema: dialect,
      anyOf: [
        {
          pattern: String.raw`^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?(?:[Zz]|[+-][0-9]{2}(?::?[0-9]{2})?)?$`,
        },
        {
          pattern: String.raw`^[0-9]{4}[0-9]{2}[0-9]{1,2}T[0-9]{2}[0-9]{2}[0-9]{1,2}(?:[Zz]|[+-][0-9]{2}(?::?[0-9]{2})?)$`,
        },
        { pattern: '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4} [0-9]{1,2}:[0-9]{1,2}$' },
      ],
      type: 'string',
    });
  });
});

describe('a layout the factory cannot read throws at the call', () => {
  const dateOnly = 'Use only %Y, %m, and %d, with %% for a percent sign.';
  const dateTimeOnly = 'Use only %Y, %m, %d, %H, %M, %S, and %z, with %% for a percent sign.';
  const timeOnly = 'Use only %H, %I, %M, %S, and %p, with %% for a percent sign.';

  it.each([
    [
      () => date({ layouts: [''] }),
      'date() layouts lists an empty layout. Supply a layout such as "%d/%m/%Y".',
    ],
    [
      () => dateTime({ layouts: ['%d/%m/%Y %H:%M', ''] }),
      'dateTime() layouts lists an empty layout. Supply a layout such as "%d/%m/%Y %H:%M".',
    ],
    [
      () => time({ layouts: [''] }),
      'time() layouts lists an empty layout. Supply a layout such as "%I:%M%p".',
    ],
    [
      () => date({ layouts: ['%d/%b/%Y'] }),
      `date() layout "%d/%b/%Y" holds %b, which no layout reads. ${dateOnly}`,
    ],
    [
      () => dateTime({ layouts: ['%d/%m/%Y %H:%M:%S.%f'] }),
      `dateTime() layout "%d/%m/%Y %H:%M:%S.%f" holds %f, which no layout reads. ${dateTimeOnly}`,
    ],
    [
      () => time({ layouts: ['%H:%M %Z'] }),
      `time() layout "%H:%M %Z" holds %Z, which no layout reads. ${timeOnly}`,
    ],
    [
      () => date({ layouts: ['%Y-%m-%d %H'] }),
      `date() layout "%Y-%m-%d %H" holds %H, which date() does not read. ${dateOnly}`,
    ],
    [
      () => date({ layouts: ['%d/%m/%Y%z'] }),
      `date() layout "%d/%m/%Y%z" holds %z, which date() does not read. ${dateOnly}`,
    ],
    [
      () => dateTime({ layouts: ['%d/%m/%Y %I:%M%p'] }),
      `dateTime() layout "%d/%m/%Y %I:%M%p" holds %I, which dateTime() does not read. ${dateTimeOnly}`,
    ],
    [
      () => time({ layouts: ['%d %H:%M'] }),
      `time() layout "%d %H:%M" holds %d, which time() does not read. ${timeOnly}`,
    ],
    [
      () => time({ layouts: ['%H:%M%z'] }),
      `time() layout "%H:%M%z" holds %z, which time() does not read. ${timeOnly}`,
    ],
    [
      () => date({ layouts: ['%d/%m/%Y%'] }),
      'date() layout "%d/%m/%Y%" ends with a lone %. Write %% for a percent sign.',
    ],
    [
      () => time({ layouts: ['%H:%M %%%'] }),
      'time() layout "%H:%M %%%" ends with a lone %. Write %% for a percent sign.',
    ],
    [() => date({ layouts: ['%d/%m'] }), 'date() layout "%d/%m" holds no year. Add %Y.'],
    [() => date({ layouts: ['%Y-%d'] }), 'date() layout "%Y-%d" holds no month. Add %m.'],
    [() => date({ layouts: ['%Y-%m'] }), 'date() layout "%Y-%m" holds no day. Add %d.'],
    [() => date({ layouts: ['%%Y-%m-%d'] }), 'date() layout "%%Y-%m-%d" holds no year. Add %Y.'],
    [
      () => dateTime({ layouts: ['%d/%m/%Y'] }),
      'dateTime() layout "%d/%m/%Y" holds no hour. Add %H.',
    ],
    [
      () => dateTime({ layouts: ['%d/%m/%Y %H'] }),
      'dateTime() layout "%d/%m/%Y %H" holds no minute. Add %M.',
    ],
    [
      () => time({ layouts: ['%M:%S'] }),
      'time() layout "%M:%S" holds no hour. Add %H, or %I with %p.',
    ],
    [() => time({ layouts: ['%Hh'] }), 'time() layout "%Hh" holds no minute. Add %M.'],
    [
      () => date({ layouts: ['%d/%m/%Y/%d'] }),
      'date() layout "%d/%m/%Y/%d" holds the day twice. Write each field once.',
    ],
    [
      () => dateTime({ layouts: ['%d/%m/%Y %H:%M %z%z'] }),
      'dateTime() layout "%d/%m/%Y %H:%M %z%z" holds the offset twice. Write each field once.',
    ],
    [
      () => time({ layouts: ['%H:%M %I%p'] }),
      'time() layout "%H:%M %I%p" holds the hour twice. Write each field once.',
    ],
    [
      () => time({ layouts: ['%I:%M%p%p'] }),
      'time() layout "%I:%M%p%p" holds %p twice. Write each field once.',
    ],
    [
      () => time({ layouts: ['%I:%M'] }),
      'time() layout "%I:%M" holds %I without %p. Add %p, or write %H for an hour from 0 through 23.',
    ],
    [
      () => time({ layouts: ['%H:%M%p'] }),
      'time() layout "%H:%M%p" holds %p without %I. Write %I for an hour from 1 through 12, or leave out %p.',
    ],
    [
      () => dateTime({ layouts: ['%Y%m%dT%H%M%SZ'] }),
      'dateTime() layout "%Y%m%dT%H%M%SZ" holds a literal Z, which would read a UTC time as local time. Write %z, which reads Z as UTC and every other offset as that offset.',
    ],
    [
      () => dateTime({ layouts: ['%d/%m/%Y %H:%Mz'] }),
      'dateTime() layout "%d/%m/%Y %H:%Mz" holds a literal z, which would read a UTC time as local time. Write %z, which reads Z as UTC and every other offset as that offset.',
    ],
  ])('%#', (call, message) => {
    expect(faultOf(call)).toEqual(declarationFault(message));
  });

  it.each([
    () => date({ layouts: ['%Y%m%d', '%d %m %Y'] }),
    () => date({ layouts: ['Z%Y%m%dz'] }),
    () => dateTime({ layouts: ['%Y%m%dT%H%M%S%z'] }),
    () => time({ layouts: ['%I:%M:%S%p', '%H%M', 'at %H:%M'] }),
  ])('accepts a layout its factory reads, %#', (call) => {
    expect(faultOf(call)).toBeUndefined();
  });
});
