import { expect, test } from 'vite-plus/test';

const catalog = await import('../src/index.js');

test('the root export holds the nine factories and createValidator', () => {
  expect(Object.keys(catalog).toSorted()).toEqual([
    'createValidator',
    'date',
    'integer',
    'number',
    'oneOf',
    'path',
    'port',
    'text',
    'url',
    'uuid',
  ]);
});

test.each([
  ['text', catalog.text()],
  ['integer', catalog.integer()],
  ['number', catalog.number()],
  ['port', catalog.port()],
  ['oneOf', catalog.oneOf(['a'])],
  ['url', catalog.url()],
  ['uuid', catalog.uuid()],
  ['date', catalog.date()],
  ['path', catalog.path()],
])(
  '%s() returns a frozen value from the package that publishes an input schema',
  (_name, value) => {
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value['~standard'])).toBe(true);
    expect(value['~standard'].vendor).toBe('@loomcli/validators');
    expect(value['~standard'].jsonSchema.input).toBeTypeOf('function');
  },
);

// A projection prints the published schema as it is, so its key order is part of the contract.
test.each([
  [
    'text',
    catalog.text({ maxLength: 8, pattern: /^a/u }),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","minLength":1,"maxLength":8,"pattern":"^a"}',
  ],
  [
    'integer',
    catalog.integer({ min: 1, max: 9 }),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"integer","minimum":1,"maximum":9}',
  ],
  [
    'oneOf',
    catalog.oneOf(['b', 'a']),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["b","a"]}',
  ],
  [
    'url',
    catalog.url({ protocols: ['https'] }),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"uri","pattern":"^(?:[hH][tT][tT][pP][sS]):"}',
  ],
  [
    'uuid',
    catalog.uuid(),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"uuid"}',
  ],
  [
    'date',
    catalog.date(),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"date"}',
  ],
  [
    'path',
    catalog.path(),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","minLength":1}',
  ],
  [
    'number',
    catalog.number({ min: 0 }),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"number","minimum":0}',
  ],
  [
    'port',
    catalog.port(),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"integer","minimum":1,"maximum":65535}',
  ],
])(
  '%s() publishes $schema, then type, then its keywords in the documented order',
  (_name, value, printed) => {
    expect(JSON.stringify(value['~standard'].jsonSchema.input({ target: 'draft-2020-12' }))).toBe(
      printed,
    );
  },
);
