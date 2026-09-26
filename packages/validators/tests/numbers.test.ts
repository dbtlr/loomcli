import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@loomcli/core';
import { describe, expect, it } from 'vite-plus/test';

import { integer, number, port } from '../src/index.js';
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

type NumberValidator = StandardSchemaV1<string, number> & StandardJSONSchemaV1<string, number>;

/** What one accepted token reads as, whether that number satisfies the schema, and whether it is `-0`. */
async function acceptance(validator: NumberValidator, token: string) {
  const result = await verdict(validator, token);
  const value = result.issues === undefined ? result.value : undefined;
  return {
    conforms: value !== undefined && conforms(validator, value),
    negativeZero: Object.is(value, -0),
    value,
  };
}

describe('integer', () => {
  const accepted: [string, NumberValidator, string, number][] = [
    ['zero', integer(), '0', 0],
    ['a positive number', integer(), '42', 42],
    ['a negative number', integer(), '-5', -5],
    ['negative zero reads as zero', integer(), '-0', 0],
    ['leading zeros', integer(), '007', 7],
    ['a negative number with leading zeros', integer(), '-007', -7],
    ['the largest safe integer', integer(), '9007199254740991', Number.MAX_SAFE_INTEGER],
    ['the smallest safe integer', integer(), '-9007199254740991', Number.MIN_SAFE_INTEGER],
    ['the largest safe integer with leading zeros', integer(), '0009007199254740991', 2 ** 53 - 1],
    ['the lower bound', integer({ max: 10, min: 1 }), '1', 1],
    ['the upper bound', integer({ max: 10, min: 1 }), '10', 10],
    ['a bound with a leading zero', integer({ max: 10, min: 1 }), '01', 1],
    ['a negative lower bound', integer({ min: -5 }), '-5', -5],
    ['negative zero at a lower bound of zero', integer({ min: 0 }), '-0', 0],
  ];

  it.each(accepted)('accepts %s', async (_name, validator, token, value) => {
    await expect(acceptance(validator, token)).resolves.toEqual({
      conforms: true,
      negativeZero: false,
      value,
    });
  });

  const rejected: [NumberValidator, string, string][] = [
    ...[
      'abc',
      '',
      ' 1',
      '1 ',
      '+1',
      '1_000',
      '3.0',
      '1e3',
      '0x10',
      '0o7',
      '0b1',
      '9007199254740992',
      '-9007199254740992',
      '١٢',
      '--1',
      '-',
    ].map((token): [NumberValidator, string, string] => [
      integer(),
      token,
      'Expected a whole number.',
    ]),
    ...['1', '10', '-3', 'abc'].map((token): [NumberValidator, string, string] => [
      integer({ max: 9, min: 2 }),
      token,
      'Expected a whole number from 2 through 9.',
    ]),
    [integer({ min: 1 }), '0', 'Expected a whole number of at least 1.'],
    [integer({ max: 10 }), '11', 'Expected a whole number of at most 10.'],
  ];

  it.each(rejected)('rejects %#', async (validator, token, message) => {
    await expect(rejection(validator, token)).resolves.toEqual(rejectedWith(message));
  });

  it('publishes the type and each bound', () => {
    expect(published(integer())).toEqual({ $schema: dialect, type: 'integer' });
    expect(published(integer({ max: 10, min: 1 }))).toEqual({
      $schema: dialect,
      maximum: 10,
      minimum: 1,
      type: 'integer',
    });
  });

  const faults: [string, unknown, string][] = [
    [
      'options that are not an object',
      'min',
      'integer() options is not a plain object. Supply an object or leave it out.',
    ],
    [
      'a string min',
      { min: '1' },
      'integer() min is not a safe integer. Supply a whole number from -9007199254740991 through 9007199254740991.',
    ],
    [
      'a fractional max',
      { max: 1.5 },
      'integer() max is not a safe integer. Supply a whole number from -9007199254740991 through 9007199254740991.',
    ],
    [
      'an unsafe max',
      { max: 2 ** 53 },
      'integer() max is not a safe integer. Supply a whole number from -9007199254740991 through 9007199254740991.',
    ],
    [
      'min above max',
      { max: 1, min: 5 },
      'integer() min 5 is above max 1. Supply a min at or below max.',
    ],
  ];

  it.each(faults)('throws from the call for %s', (_name, options, message) => {
    expect(faultOf(() => Reflect.apply(integer, undefined, [options]))).toEqual(
      declarationFault(message),
    );
  });
});

describe('number', () => {
  const accepted: [string, NumberValidator, string, number][] = [
    ['a whole number', number(), '1', 1],
    ['a negative fraction', number(), '-2.5', -2.5],
    ['a fraction below one', number(), '0.5', 0.5],
    ['an exponent', number(), '1e3', 1000],
    ['an uppercase exponent', number(), '1E3', 1000],
    ['a negative exponent', number(), '1e-3', 0.001],
    ['a signed exponent', number(), '1e+3', 1000],
    ['negative zero reads as zero', number(), '-0', 0],
    ['negative zero with a fraction reads as zero', number(), '-0.0', 0],
    ['leading zeros', number(), '007.5', 7.5],
    ['the largest finite number', number(), '1.7976931348623157e308', Number.MAX_VALUE],
    ['the smallest positive number', number(), '5e-324', Number.MIN_VALUE],
    ['beyond the safe integers', number(), '9007199254740993', 2 ** 53],
    ['the lower bound', number({ max: 1, min: 0 }), '0', 0],
    ['the upper bound', number({ max: 1, min: 0 }), '1', 1],
    ['a value inside the bounds', number({ max: 1, min: 0 }), '0.5', 0.5],
    ['negative zero at a lower bound of zero', number({ max: 1, min: 0 }), '-0', 0],
  ];

  it.each(accepted)('accepts %s', async (_name, validator, token, value) => {
    await expect(acceptance(validator, token)).resolves.toEqual({
      conforms: true,
      negativeZero: false,
      value,
    });
  });

  const rejected: [NumberValidator, string, string][] = [
    ...[
      '.5',
      '5.',
      'Infinity',
      '-Infinity',
      'NaN',
      ' 1',
      '1 ',
      '+1',
      '1_0',
      '0x1',
      '',
      '1e',
      'e3',
      '1e999',
      '-',
    ].map((token): [NumberValidator, string, string] => [number(), token, 'Expected a number.']),
    ...['2', '-0.5', '1.5'].map((token): [NumberValidator, string, string] => [
      number({ max: 1, min: 0 }),
      token,
      'Expected a number from 0 through 1.',
    ]),
    [number({ min: 0 }), '-3', 'Expected a number of at least 0.'],
    [number({ max: 1 }), '2', 'Expected a number of at most 1.'],
    [number({ min: 0.5 }), '0.25', 'Expected a number of at least 0.5.'],
    [number({ max: 1e21 }), '2e21', 'Expected a number of at most 1e+21.'],
  ];

  it.each(rejected)('rejects %#', async (validator, token, message) => {
    await expect(rejection(validator, token)).resolves.toEqual(rejectedWith(message));
  });

  it('publishes the type and each bound', () => {
    expect(published(number())).toEqual({ $schema: dialect, type: 'number' });
    expect(published(number({ max: 1, min: 0 }))).toEqual({
      $schema: dialect,
      maximum: 1,
      minimum: 0,
      type: 'number',
    });
  });

  const faults: [string, unknown, string][] = [
    [
      'options that are not an object',
      [],
      'number() options is not a plain object. Supply an object or leave it out.',
    ],
    ['a string min', { min: '0' }, 'number() min is not a finite number. Supply a finite number.'],
    [
      'an infinite max',
      { max: Number.POSITIVE_INFINITY },
      'number() max is not a finite number. Supply a finite number.',
    ],
    [
      'a NaN min',
      { min: Number.NaN },
      'number() min is not a finite number. Supply a finite number.',
    ],
    [
      'min above max',
      { max: 0, min: 1 },
      'number() min 1 is above max 0. Supply a min at or below max.',
    ],
  ];

  it.each(faults)('throws from the call for %s', (_name, options, message) => {
    expect(faultOf(() => Reflect.apply(number, undefined, [options]))).toEqual(
      declarationFault(message),
    );
  });
});

describe('port', () => {
  const accepted: [string, number][] = [
    ['1', 1],
    ['65535', 65_535],
    ['8080', 8080],
    ['08080', 8080],
  ];

  it.each(accepted)('accepts %s', async (token, value) => {
    await expect(acceptance(port(), token)).resolves.toEqual({
      conforms: true,
      negativeZero: false,
      value,
    });
  });

  it.each(['0', '65536', '-1', 'abc', '80.0', ''])('rejects %j', async (token) => {
    await expect(rejection(port(), token)).resolves.toEqual(
      rejectedWith('Expected a port number from 1 through 65535.'),
    );
  });

  it('publishes the port range', () => {
    expect(published(port())).toEqual({
      $schema: dialect,
      maximum: 65_535,
      minimum: 1,
      type: 'integer',
    });
  });
});
