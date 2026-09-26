import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/input-schema.mjs', import.meta.url);

/** The key the library writes, which core neither reads nor removes. */
const draft = { $schema: 'https://json-schema.org/draft/2020-12/schema' };

function inspect(graph: string, mode = 'json') {
  const result = invoke(fixture, [graph, mode]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test('a zod enum publishes its input-side schema on the option node beside its default', () => {
  const graph = inspect('zod');
  const count = graph.root.children[0];
  expect(count.options[0]).toMatchObject({
    default: { value: 'bytes' },
    name: 'metric',
    schema: { ...draft, enum: ['bytes', 'words', 'lines'], type: 'string' },
    validated: true,
  });
});

test('the input side alone is published: a transform behind a pattern reads as the pattern', () => {
  const count = inspect('zod').root.children[0];
  expect(count.options[1]).toMatchObject({
    name: 'min-bytes',
    schema: { ...draft, pattern: '^[0-9]+$', type: 'string' },
  });
});

test("a variadic argument publishes its validator's schema unchanged and a coerced global its integer bounds", () => {
  const graph = inspect('zod');
  expect(graph.root.children[0].arguments[0]).toMatchObject({
    name: 'files',
    variadic: true,
  });
  // Core builds no array schema around the validator's own.
  expect(graph.root.children[0].arguments[0].schema).toEqual({
    ...draft,
    minLength: 1,
    type: 'string',
  });
  expect(graph.globals[0]).toMatchObject({
    name: 'limit',
    schema: { ...draft, maximum: 9_007_199_254_740_991, minimum: 1, type: 'integer' },
  });
});

test('a Boolean option and an unvalidated argument read null', () => {
  const graph = inspect('zod');
  expect(graph.root.children[0].options[2]).toMatchObject({
    name: 'timing',
    schema: null,
    type: 'boolean',
  });
  expect(graph.root.children[1].arguments[0]).toMatchObject({
    name: 'path',
    schema: null,
    validated: false,
  });
});

test('a validator with no converter reads null beside validated: true', () => {
  const graph = inspect('plain');
  expect(graph.root.options[0]).toMatchObject({ name: 'size', schema: null, validated: true });
  expect(graph.root.arguments[0]).toMatchObject({
    name: 'path',
    schema: null,
    validateOmitted: true,
    validated: true,
  });
});

test('a converter that throws, on reach or on call, or returns anything but a plain object reads null', () => {
  const graph = inspect('failing');
  expect(graph.root.options[0]).toMatchObject({ name: 'minimum', schema: null, validated: true });
  expect(graph.root.options[1]).toMatchObject({ name: 'list', schema: null, validated: true });
  expect(graph.root.options[2]).toMatchObject({ name: 'lazy', schema: null, validated: true });
  expect(graph.root.arguments[0]).toMatchObject({ name: 'files', schema: null, validated: true });
});

test('the stored value is a frozen copy to every depth, one per input, with the target passed', () => {
  expect(inspect('shared', 'copies')).toEqual({
    distinct: true,
    equal: true,
    libraryFrozen: false,
    nestedFrozen: true,
    rejected: true,
  });
  expect(inspect('shared').root.options[1].schema).toEqual({
    items: { pattern: '^[0-9]+$', type: 'string' },
    target: 'draft-2020-12',
    type: 'array',
  });
});

test('inspect() calls the converter once per input, and a run with no middleware calls none', () => {
  expect(inspect('shared', 'calls')).toEqual({
    code: 0,
    inspected: 2,
    options: { target: 'draft-2020-12' },
    ran: 0,
  });
});

test('a run with a middleware chain calls the converter once per input, like inspect()', () => {
  const result = invoke(fixture, ['observed', 'calls']);
  expect(result.stderr).toBe('');
  const last = result.stdout.trimEnd().split('\n').at(-1);
  expect(JSON.parse(last ?? '')).toEqual({
    code: 0,
    inspected: 1,
    options: { target: 'draft-2020-12' },
    ran: 1,
  });
});

test('a middleware reads the schema on the graph a run builds for its chain', () => {
  const result = invoke(fixture, ['observed', 'run']);
  expect(result.stderr).toBe('');
  const [schema, code] = result.stdout.trimEnd().split('\n');
  expect(JSON.parse(schema ?? '')).toEqual({
    ...draft,
    enum: ['bytes', 'words', 'lines'],
    type: 'string',
  });
  expect(code).toBe('{"code":0}');
});
