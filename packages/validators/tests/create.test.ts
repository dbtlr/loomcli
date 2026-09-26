import type { StandardSchemaV1 } from '@loomcli/core';
import { expect, expectTypeOf, test } from 'vite-plus/test';

import { createValidator } from '../src/index.js';
import type { ParseResult, Validator } from '../src/index.js';
import { declarationFault, faultOf, published, verdict } from './support.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

const outsideRun =
  'This validator reads the validation context, which only exists during a Loom run.';

const lowercase = createValidator({
  inputSchema: { pattern: '^[a-z]+$', type: 'string' },
  parse: (raw) =>
    /^[a-z]+$/u.test(raw)
      ? { value: raw }
      : { issues: [{ message: 'Expected lowercase letters.' }] },
});

test('a validator built with an input schema is a frozen Standard Schema value from the package', () => {
  expectTypeOf(lowercase).toEqualTypeOf<Validator<string>>();
  expect(Object.isFrozen(lowercase)).toBe(true);
  expect(Object.isFrozen(lowercase['~standard'])).toBe(true);
  expect(lowercase['~standard'].vendor).toBe('@loomcli/validators');
  expect(lowercase['~standard'].version).toBe(1);
});

test('parse decides the verdict for each raw string', async () => {
  await expect(verdict(lowercase, 'abc')).resolves.toEqual({ value: 'abc' });
  await expect(verdict(lowercase, 'ABC')).resolves.toEqual({
    issues: [{ message: 'Expected lowercase letters.' }],
  });
});

test('the output type is inferred from the value parse returns', async () => {
  const length = createValidator({ parse: (raw) => ({ value: raw.length }) });
  expectTypeOf(length).toEqualTypeOf<StandardSchemaV1<string, number>>();
  await expect(verdict(length, 'four')).resolves.toEqual({ value: 4 });
});

test('a promise from parse is the verdict', async () => {
  const later = createValidator({
    parse: async (raw): Promise<ParseResult<string>> => {
      await Promise.resolve();
      return { value: raw.toUpperCase() };
    },
  });
  await expect(verdict(later, 'up')).resolves.toEqual({ value: 'UP' });
});

test('the draft 2020-12 input schema puts $schema first, then the declared keywords', () => {
  const schema = published(lowercase);
  expect(schema).toEqual({ $schema: dialect, pattern: '^[a-z]+$', type: 'string' });
  expect(Object.keys(schema)[0]).toBe('$schema');
});

test('each input schema call returns a new plain object the caller may change', () => {
  const first = published(lowercase);
  first.type = 'number';
  const second = published(lowercase);
  expect(second).not.toBe(first);
  expect(second.type).toBe('string');
  expect(Object.getPrototypeOf(second)).toBe(Object.prototype);
});

test('the input schema is copied at the call, so a later change to the declared object changes nothing', () => {
  const declared = { enum: ['a', 'b'], type: 'string' };
  const validator = createValidator({ inputSchema: declared, parse: (raw) => ({ value: raw }) });
  declared.type = 'number';
  declared.enum.push('c');
  expect(published(validator)).toEqual({ $schema: dialect, enum: ['a', 'b'], type: 'string' });
});

test('any target other than draft 2020-12 throws', () => {
  const { jsonSchema } = lowercase['~standard'];
  expect(() => jsonSchema.input({ target: 'draft-07' })).toThrow(Error);
  expect(() => jsonSchema.input({ target: 'openapi-3.0' })).toThrow(Error);
});

test('the output schema throws for every target', () => {
  const { jsonSchema } = lowercase['~standard'];
  expect(() => jsonSchema.output({ target: 'draft-2020-12' })).toThrow(Error);
  expect(() => jsonSchema.output({ target: 'draft-07' })).toThrow(Error);
});

test('without an input schema the value implements no JSON Schema converter', () => {
  const plain = createValidator({ parse: (raw) => ({ value: raw }) });
  expect('jsonSchema' in plain['~standard']).toBe(false);
  expect(Object.isFrozen(plain)).toBe(true);
});

test('outside a run parse receives a context whose every field throws the context sentence', async () => {
  const fields = ['phase', 'host', 'input', 'command', 'passthrough', 'supplied'];
  const reads = fields.map((field) =>
    createValidator({ parse: (_raw, context) => ({ value: Reflect.get(context, field) }) }),
  );
  for (const read of reads) {
    expect(faultOf(() => read['~standard'].validate('x'))).toEqual(declarationFault(outsideRun));
  }
  const ignores = createValidator({ parse: (raw, _context) => ({ value: raw }) });
  await expect(verdict(ignores, 'x')).resolves.toEqual({ value: 'x' });
});

test('a value that is not a string throws rather than reaching parse', () => {
  let called = false;
  const validator = createValidator({
    parse: (raw) => {
      called = true;
      return { value: raw };
    },
  });
  expect(() => validator['~standard'].validate(8080)).toThrow(TypeError);
  expect(called).toBe(false);
});

const faults: [string, unknown, string][] = [
  [
    'a definition that is not a plain object',
    null,
    'createValidator() definition is not a plain object. Supply an object with a parse function.',
  ],
  [
    'a definition that is an array',
    [],
    'createValidator() definition is not a plain object. Supply an object with a parse function.',
  ],
  [
    'a parse that is not a function',
    { parse: 'raw' },
    'createValidator() parse is not a function. Supply a function that validates one raw string.',
  ],
  [
    'an input schema that is not a plain object',
    { inputSchema: ['string'], parse: () => ({ value: 1 }) },
    'createValidator() inputSchema is not a plain object. Supply the JSON Schema as a plain object.',
  ],
  [
    'an input schema that declares its own $schema',
    { inputSchema: { $schema: dialect, type: 'string' }, parse: () => ({ value: 1 }) },
    'createValidator() inputSchema declares its own $schema. Leave out $schema, which the validator publishes itself.',
  ],
];

test.each(faults)('%s throws a declaration fault from the call', (_name, definition, message) => {
  expect(faultOf(() => Reflect.apply(createValidator, undefined, [definition]))).toEqual(
    declarationFault(message),
  );
});
