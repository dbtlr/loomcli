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
