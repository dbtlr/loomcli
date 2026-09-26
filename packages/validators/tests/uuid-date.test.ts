import { describe, expect, it } from 'vite-plus/test';

import { date, uuid } from '../src/index.js';
import { conforms, published, rejectedWith, rejection, verdict } from './support.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

describe('uuid', () => {
  const accepted: [string, string][] = [
    ['123e4567-e89b-12d3-a456-426614174000', '123e4567-e89b-12d3-a456-426614174000'],
    ['123E4567-E89B-12D3-A456-426614174000', '123e4567-e89b-12d3-a456-426614174000'],
    ['AbCdEf01-2345-6789-aBcD-eF0123456789', 'abcdef01-2345-6789-abcd-ef0123456789'],
    ['00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'],
    ['ffffffff-ffff-ffff-ffff-ffffffffffff', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
    ['FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
    ['01890a5d-ac96-774b-bcce-b302099a8057', '01890a5d-ac96-774b-bcce-b302099a8057'],
  ];

  it.each(accepted)('accepts %j as lowercase', async (token, value) => {
    await expect(verdict(uuid(), token)).resolves.toEqual({ value });
    expect(conforms(uuid(), token)).toBe(true);
  });

  it.each([
    '',
    '9f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f',
    'urn:uuid:9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f',
    '{9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f}',
    '9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5g',
    '9f1c2d3e-4a5b-6c7d-8e9f0-a1b2c3d4e5f',
    ' 9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f',
    '9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f0',
  ])('rejects %j', async (token) => {
    await expect(rejection(uuid(), token)).resolves.toEqual(
      rejectedWith('Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000.'),
    );
  });

  it('publishes the uuid format', () => {
    expect(published(uuid())).toEqual({ $schema: dialect, format: 'uuid', type: 'string' });
  });
});

describe('date', () => {
  it.each([
    '2024-02-29',
    '0000-02-29',
    '2000-02-29',
    '0400-02-29',
    '0001-01-01',
    '9999-12-31',
    '1900-02-28',
    '2026-04-30',
  ])('accepts %j unchanged', async (token) => {
    await expect(verdict(date(), token)).resolves.toEqual({ value: token });
    expect(conforms(date(), token)).toBe(true);
  });

  it.each([
    '2026-02-29',
    '2026-13-01',
    '0100-02-29',
    '1900-02-29',
    '2026-00-10',
    '2026-01-00',
    '2026-04-31',
    '2026-01-32',
    '26-01-01',
    '2026-1-01',
    '20260101',
    '',
    '2026-01-01T00:00',
    '+2026-01-01',
    '12026-01-01',
    '١٢٣٤-01-01',
    '2026/01/01',
  ])('rejects %j', async (token) => {
    await expect(rejection(date(), token)).resolves.toEqual(
      rejectedWith('Expected a date as YYYY-MM-DD, such as 2026-09-25.'),
    );
  });

  it('publishes the date format', () => {
    expect(published(date())).toEqual({ $schema: dialect, format: 'date', type: 'string' });
  });
});
