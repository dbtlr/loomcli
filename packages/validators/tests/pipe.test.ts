/*
 * Acceptance plan for pipe (docs/libs/validators.md#pipe, ADR-0141).
 *
 * - Running. A token passes first and then each step on the value the stage before it accepted;
 *   the first rejection ends the pipe with that stage's issues unchanged, and a later stage never
 *   runs. A throwing or rejecting stage throws or rejects from the pipe unchanged.
 * - Sync and async. The pipe answers synchronously when every stage that ran answered
 *   synchronously, and with a promise once one answers with a promise.
 * - Context. A schema stage receives the options the pipe received, and a parse function receives
 *   the validation context, or outside a run the context whose fields throw the context sentence.
 * - Publishing. With a first that publishes, the pipe answers first's input schema for the same
 *   options and throws for the output side; with a first that publishes nothing, it publishes
 *   nothing. Help and the manifest of an Application run read first's schema.
 * - Types. A function step's value is typed from the previous output with no annotation; the
 *   output type is the last step's; the input type is first's; a schema step whose input type the
 *   previous output is not assignable to is a type error; the pipe is a Validator when first is.
 * - Multiple options. Core runs the pipe on each value of a multiple option.
 */

import { runInNewContext } from 'node:vm';

import { Application, validationOptions } from '@loomcli/core';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { mockProcess } from '@loomcli/testing';
import { expect, expectTypeOf, test } from 'vite-plus/test';
import { z } from 'zod';

import { createValidator, integer, oneOf, pipe, text } from '../src/index.js';
import type { Validator } from '../src/index.js';
import { declarationFault, faultOf, foreignIssue, published, verdict } from './support.js';

const outsideRun =
  'This validator reads the validation context, which only exists during a Loom run. Call the validator through an Application run or with the options validationOptions builds, or leave the context unread.';

/** A schema step that reads only strings, which a number output cannot fit. */
const word = z.string();

/** A schema step that reads anything, so it never fails a fit itself. */
const open = z.unknown();

/** A parse function step whose output type differs from its input type. */
const positive = (count: number) => ({ value: count > 0 });

/** A parse function step that answers through a promise with the token's length. */
async function measured(raw: string) {
  await Promise.resolve();
  return { value: raw.length };
}

/** A parse function step that adds one, reused across a long chain. */
const add = (count: number) => ({ value: count + 1 });

const pairs = pipe(integer({ min: 2 }), (count) =>
  count % 2 === 0 ? { value: count } : { issues: [{ message: 'Expected an even number.' }] },
);

test('a token passes first and then the step, which reads the value first accepted', async () => {
  expectTypeOf<(typeof pairs)['~standard']['types']>().toEqualTypeOf<
    { readonly input: string; readonly output: number } | undefined
  >();
  await expect(verdict(pairs, '4')).resolves.toEqual({ value: 4 });
  await expect(verdict(pairs, '3')).resolves.toEqual({
    issues: [{ message: 'Expected an even number.' }],
  });
});

test("first's rejection ends the pipe with first's issues, and the step never runs", async () => {
  let ran = false;
  const watched = pipe(integer({ min: 2 }), (count) => {
    ran = true;
    return { value: count };
  });
  const result = await verdict(watched, 'abc');
  expect(result.issues?.map((issue) => issue.message)).toEqual([
    'Expected a whole number of at least 2.',
  ]);
  expect(ran).toBe(false);
});

test('the pipe answers synchronously when every stage that ran answered synchronously', () => {
  const answer = pairs['~standard'].validate('4');
  expect(answer).not.toBeInstanceOf(Promise);
  expect(answer).toEqual({ value: 4 });
});

test('the pipe answers with a promise once a stage answers with one', async () => {
  const later = pipe(integer(), async (count) => {
    await Promise.resolve();
    return { value: count * 2 };
  });
  expectTypeOf<StandardSchemaV1.InferOutput<typeof later>>().toEqualTypeOf<number>();
  const answer = later['~standard'].validate('21');
  expect(answer).toBeInstanceOf(Promise);
  await expect(answer).resolves.toEqual({ value: 42 });
});

test('steps run in order, each on the value the stage before it accepted, and may transform', async () => {
  const tags = pipe(
    text({ maxLength: 200 }),
    (raw) => ({ value: raw.split(',') }),
    (list) => ({ value: list.length }),
  );
  expectTypeOf<StandardSchemaV1.InferOutput<typeof tags>>().toEqualTypeOf<number>();
  await expect(verdict(tags, 'a,b,c')).resolves.toEqual({ value: 3 });
});

test("a stage's issues pass through unchanged, code, parameters, and path included", async () => {
  const issue = foreignIssue({ code: '@acme/x', message: 'Expected x.', path: ['deep'] });
  const result = await verdict(
    pipe(text(), () => ({ issues: [issue] })),
    'any',
  );
  expect(result.issues?.[0]).toBe(issue);
});

test('a stage that throws or rejects throws or rejects from the pipe unchanged', async () => {
  const thrown = new Error('author bug');
  const throws = pipe(text(), () => {
    throw thrown;
  });
  expect(() => throws['~standard'].validate('x')).toThrow(thrown);
  const rejects = pipe(text(), () => Promise.reject(thrown));
  await expect(rejects['~standard'].validate('x')).rejects.toBe(thrown);
});

test('a Zod schema works as first and as a step, and a callable schema counts as a schema', async () => {
  const lanes = pipe(
    integer({ min: 1 }),
    z.number().refine((count) => count % 4 === 0, 'Expected a multiple of 4.'),
  );
  await expect(verdict(lanes, '8')).resolves.toEqual({ value: 8 });
  const rejected = await verdict(lanes, '6');
  expect(rejected.issues?.map((issue) => issue.message)).toEqual(['Expected a multiple of 4.']);

  const shouted = pipe(z.string().min(1), (raw) => ({ value: raw.toUpperCase() }));
  await expect(verdict(shouted, 'hi')).resolves.toEqual({ value: 'HI' });

  // A schema library's value may be a function carrying `~standard`, as an ArkType type is.
  const callable = Object.assign(() => 'never called', {
    '~standard': {
      validate: (value: unknown) => ({ value: `[${String(value)}]` }),
      vendor: 'callable',
      version: 1 as const,
    },
  });
  await expect(verdict(pipe(text(), callable), 'x')).resolves.toEqual({ value: '[x]' });
});

test('a schema stage receives the options the pipe received, and a step the validation context', async () => {
  const seen: unknown[] = [];
  const records: StandardSchemaV1<string, string> = {
    '~standard': {
      validate: (value, options) => {
        seen.push(options);
        return { value: String(value) };
      },
      vendor: 'probe',
      version: 1,
    },
  };
  const phases = pipe(records, (raw, context) => ({ value: `${raw}:${context.phase}` }));
  const options = validationOptions(mockProcess(), {
    input: { global: false, kind: 'option', name: 'label' },
    phase: 'invocation',
  });
  expect(phases['~standard'].validate('a', options)).toEqual({ value: 'a:invocation' });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toBe(options);
});

test('outside a run a step that reads the context throws the context sentence', () => {
  const reads = pipe(text(), (raw, context) => ({ value: `${raw}${context.phase}` }));
  expect(faultOf(() => reads['~standard'].validate('x'))).toEqual(declarationFault(outsideRun));
  const ignores = pipe(text(), (raw) => ({ value: raw }));
  expect(ignores['~standard'].validate('x')).toEqual({ value: 'x' });
});

test("the pipe publishes first's input schema for the same options, and no output schema", () => {
  expectTypeOf(pairs).toEqualTypeOf<Validator<number>>();
  expect(published(pairs)).toEqual(published(integer({ min: 2 })));
  expect(() => pairs['~standard'].jsonSchema.input({ target: 'draft-07' })).toThrow(Error);
  expect(() => pairs['~standard'].jsonSchema.output({ target: 'draft-2020-12' })).toThrow(Error);

  const zodFirst = pipe(z.string().min(3), (raw) => ({ value: raw.length }));
  const { jsonSchema } = zodFirst['~standard'];
  expect(jsonSchema.input({ target: 'draft-07' })).toEqual(
    z.string().min(3)['~standard'].jsonSchema.input({ target: 'draft-07' }),
  );
});

test('a pipe whose first publishes nothing publishes nothing', () => {
  const plain = pipe(createValidator({ parse: (raw) => ({ value: raw }) }), (raw) => ({
    value: raw.length,
  }));
  expect('jsonSchema' in plain['~standard']).toBe(false);
  expectTypeOf(plain).toEqualTypeOf<StandardSchemaV1<string, number>>();
});

test("the pipe's input type is first's, so an omission-aware first sits beside validateOmitted", async () => {
  const defaulted: StandardSchemaV1<string | undefined, string> = {
    '~standard': {
      validate: (value) => ({ value: typeof value === 'string' ? value : 'fallback' }),
      vendor: 'probe',
      version: 1,
    },
  };
  const named = pipe(defaulted, (raw) => ({ value: raw.toUpperCase() }));
  expectTypeOf<StandardSchemaV1.InferInput<typeof named>>().toEqualTypeOf<string | undefined>();
  const app = new Application('greet')
    .option('name', { type: 'string', validate: named, validateOmitted: true })
    .action(({ options, out }) => out.print(`hello ${options.name}`));
  const mock = mockProcess({ argv: [] });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toBe('hello FALLBACK\n');
});

test('a schema step whose input type the previous output is not assignable to is a type error', () => {
  // @ts-expect-error a step reading 'a' | 'b' cannot read every string text() accepts
  pipe(text(), z.enum(['a', 'b']));
  const maybe: StandardSchemaV1<string | undefined, string | undefined> = {
    '~standard': {
      validate: (value) => ({ value: typeof value === 'string' ? value : undefined }),
      vendor: 'probe',
      version: 1,
    },
  };
  // @ts-expect-error a catalog step reads a string, and the output before it may be undefined
  pipe(maybe, text());
  // @ts-expect-error a step reading a string cannot follow a number
  pipe(integer(), z.string());
  // @ts-expect-error a step reading 'a' | 'b' cannot read every string the function step answers
  pipe(text(), (raw) => ({ value: raw.trim() }), z.enum(['a', 'b']));
  // @ts-expect-error a step reading a string cannot follow the number the function step answers
  pipe(text(), (raw) => ({ value: raw.length }), z.string());
  // A step reading a wider type fits, and a schema step after a parse function keeps its types.
  const widened = pipe(oneOf(['a', 'b']), z.string(), (raw) => ({ value: raw.length }), z.number());
  expectTypeOf<StandardSchemaV1.InferOutput<typeof widened>>().toEqualTypeOf<number>();
});

test('a pipe nests as first and as a step, and eight steps keep their types', async () => {
  const doubled = pipe(integer(), (count) => ({ value: count * 2 }));
  const asFirst = pipe(doubled, (count) => ({ value: count + 1 }));
  const asStep = pipe(text(), doubled);
  expectTypeOf<StandardSchemaV1.InferOutput<typeof asFirst>>().toEqualTypeOf<number>();
  expectTypeOf<StandardSchemaV1.InferOutput<typeof asStep>>().toEqualTypeOf<number>();
  // @ts-expect-error doubled reads a string, and the output before it is a number
  pipe(integer(), doubled);
  const eight = pipe(integer(), add, add, add, add, add, add, add, (count) => ({
    value: String(count),
  }));
  expectTypeOf<StandardSchemaV1.InferOutput<typeof eight>>().toEqualTypeOf<string>();
  await expect(verdict(eight, '0')).resolves.toEqual({ value: '7' });
  await expect(verdict(asFirst, '2')).resolves.toEqual({ value: 5 });
  await expect(verdict(asStep, '2')).resolves.toEqual({ value: 4 });
});

test("help and the manifest read first's published schema, and a multiple option checks each value", async () => {
  const app = new Application('deploy', { plugins: [help(), format(), manifest()] })
    .option('mode', {
      type: 'string',
      validate: pipe(oneOf(['dev', 'prod']), (mode) => ({ value: mode })),
    })
    .option('lanes', { multiple: true, type: 'string', validate: pairs })
    .action(({ options, out }) => out.print(`lanes ${options.lanes.join(' ')}`));

  const [mode, lanes] = app.inspect().root.options.filter((node) => node.name !== 'help');
  expect(mode?.schema).toEqual(published(oneOf(['dev', 'prod'])));
  expect(lanes?.schema).toEqual(published(integer({ min: 2 })));

  const page = mockProcess({ argv: ['--help'] });
  await app.run({ process: page });
  expect(page.stdout.text).toContain('One of: dev, prod');

  const document = mockProcess({ argv: ['--manifest'] });
  await app.run({ process: document });
  expect(document.stdout.text.replaceAll(/\s/gu, '')).toContain('"enum":["dev","prod"]');

  const ok = mockProcess({ argv: ['--lanes', '2', '--lanes', '4'] });
  await expect(app.run({ process: ok })).resolves.toBe(0);
  expect(ok.stdout.text).toBe('lanes 2 4\n');
  const odd = mockProcess({ argv: ['--lanes', '2', '--lanes', '3'] });
  await expect(app.run({ process: odd })).resolves.toBe(2);
  expect(odd.stderr.text).toContain('Expected an even number.');
});

test('a pipe is a Standard Schema value from the package, version 1, carrying no types', () => {
  expect(pairs['~standard'].vendor).toBe('@loomcli/validators');
  expect(pairs['~standard'].version).toBe(1);
  expect('types' in pairs['~standard']).toBe(false);
});

test("a step's rejection ends the pipe, and a later step never runs", async () => {
  let ran = false;
  const watched = pipe(
    text(),
    () => ({ issues: [{ message: 'Expected something else.' }] }),
    (raw: string) => {
      ran = true;
      return { value: raw };
    },
  );
  const result = await verdict(watched, 'x');
  expect(result.issues?.map((issue) => issue.message)).toEqual(['Expected something else.']);
  expect(ran).toBe(false);
});

test('after a stage answers with a promise, the later stages still run and may reject', async () => {
  const counted = pipe(text(), measured, (length) =>
    length > 2 ? { value: length } : { issues: [{ message: 'Expected more than 2 characters.' }] },
  );
  await expect(counted['~standard'].validate('abcd')).resolves.toEqual({ value: 4 });
  await expect(counted['~standard'].validate('ab')).resolves.toEqual({
    issues: [{ message: 'Expected more than 2 characters.' }],
  });
});

test('a synchronous rejection before an asynchronous stage answers synchronously', () => {
  const guarded = pipe(integer({ min: 2 }), async (count) => {
    await Promise.resolve();
    return { value: count };
  });
  const answer = guarded['~standard'].validate('abc');
  expect(answer).not.toBeInstanceOf(Promise);
  expect(answer).toEqual({
    issues: [expect.objectContaining({ message: 'Expected a whole number of at least 2.' })],
  });
});

test("a step that bypasses the types meets the platform's own error", () => {
  const values: unknown[] = [undefined];
  // @ts-expect-error the types reject a step that is neither a schema nor a function
  const broken = pipe(text(), ...values);
  expect(() => broken['~standard'].validate('x')).toThrow(TypeError);
});

test('a promise from another realm is a promise answer, and its rejection ends the pipe', async () => {
  const foreignPromise: PromiseConstructor = runInNewContext('Promise');
  const foreign: StandardSchemaV1<string, string> = {
    '~standard': {
      validate: () => foreignPromise.resolve({ issues: [{ message: 'Expected ok.' }] }),
      vendor: 'realm',
      version: 1,
    },
  };
  let ran = false;
  const guarded = pipe(text(), foreign, (raw) => {
    ran = true;
    return { value: raw };
  });
  await expect(guarded['~standard'].validate('bad')).resolves.toEqual({
    issues: [{ message: 'Expected ok.' }],
  });
  expect(ran).toBe(false);
});

test("the rejecting stage's result object comes back unchanged", async () => {
  const rejection = { issues: [{ message: 'Expected x.' }] };
  await expect(
    verdict(
      pipe(text(), () => rejection),
      'y',
    ),
  ).resolves.toBe(rejection);
});

test("the output side throws even when first's converter answers one", () => {
  const zodFirst = pipe(z.string(), (raw) => ({ value: raw.length }));
  expect(z.string()['~standard'].jsonSchema.output({ target: 'draft-2020-12' })).toBeDefined();
  expect(() => zodFirst['~standard'].jsonSchema.output({ target: 'draft-2020-12' })).toThrow(Error);
});

test('a first whose converter lacks a side, or is null, publishes nothing, as core reads it', () => {
  const partial = {
    '~standard': {
      jsonSchema: { input: () => ({ type: 'string' }) },
      validate: (value: unknown) => ({ value: String(value) }),
      vendor: 'probe',
      version: 1 as const,
    },
  };
  const empty = { '~standard': { ...partial['~standard'], jsonSchema: null } };
  for (const first of [partial, empty]) {
    const piped = pipe(first, (raw) => ({ value: raw }));
    expect('jsonSchema' in piped['~standard']).toBe(false);
  }
});

test('a publishing first keeps its own input type, an omission-aware one included', () => {
  const optional: StandardSchemaV1<string | undefined, string> &
    StandardJSONSchemaV1<string | undefined, string> = {
    '~standard': {
      jsonSchema: {
        input: () => ({ type: 'string' }),
        output: () => ({ type: 'string' }),
      },
      validate: (value) => ({ value: typeof value === 'string' ? value : '' }),
      vendor: 'probe',
      version: 1,
    },
  };
  const piped = pipe(optional, (raw) => ({ value: raw.length }));
  expectTypeOf(piped).toEqualTypeOf<
    StandardSchemaV1<string | undefined, number> & StandardJSONSchemaV1<string | undefined, number>
  >();
});

test('every overload types its output and checks the fit of each of its steps', () => {
  // Each chain ends with a step whose output type differs from the one before it.
  expectTypeOf(pipe(integer(), positive)).toEqualTypeOf<Validator<boolean>>();
  expectTypeOf(pipe(integer(), add, positive)).toEqualTypeOf<Validator<boolean>>();
  expectTypeOf(pipe(integer(), add, add, positive)).toEqualTypeOf<Validator<boolean>>();
  expectTypeOf(pipe(integer(), add, add, add, positive)).toEqualTypeOf<Validator<boolean>>();
  expectTypeOf(pipe(integer(), add, add, add, add, positive)).toEqualTypeOf<Validator<boolean>>();
  expectTypeOf(pipe(integer(), add, add, add, add, add, positive)).toEqualTypeOf<
    Validator<boolean>
  >();
  expectTypeOf(pipe(integer(), add, add, add, add, add, add, positive)).toEqualTypeOf<
    Validator<boolean>
  >();
  expectTypeOf(pipe(integer(), add, add, add, add, add, add, add, positive)).toEqualTypeOf<
    Validator<boolean>
  >();
  // A bad step at each position, followed by steps that accept anything, fails on its own fit.
  // @ts-expect-error step 1 of 1 cannot read a number
  pipe(integer(), word);
  // @ts-expect-error step 1 of 2 cannot read a number
  pipe(integer(), word, open);
  // @ts-expect-error step 2 of 2 cannot read a number
  pipe(integer(), add, word);
  // @ts-expect-error step 1 of 3 cannot read a number
  pipe(integer(), word, open, open);
  // @ts-expect-error step 2 of 3 cannot read a number
  pipe(integer(), add, word, open);
  // @ts-expect-error step 3 of 3 cannot read a number
  pipe(integer(), add, add, word);
  // @ts-expect-error step 1 of 4 cannot read a number
  pipe(integer(), word, open, open, open);
  // @ts-expect-error step 2 of 4 cannot read a number
  pipe(integer(), add, word, open, open);
  // @ts-expect-error step 3 of 4 cannot read a number
  pipe(integer(), add, add, word, open);
  // @ts-expect-error step 4 of 4 cannot read a number
  pipe(integer(), add, add, add, word);
  // @ts-expect-error step 1 of 5 cannot read a number
  pipe(integer(), word, open, open, open, open);
  // @ts-expect-error step 2 of 5 cannot read a number
  pipe(integer(), add, word, open, open, open);
  // @ts-expect-error step 3 of 5 cannot read a number
  pipe(integer(), add, add, word, open, open);
  // @ts-expect-error step 4 of 5 cannot read a number
  pipe(integer(), add, add, add, word, open);
  // @ts-expect-error step 5 of 5 cannot read a number
  pipe(integer(), add, add, add, add, word);
  // @ts-expect-error step 1 of 6 cannot read a number
  pipe(integer(), word, open, open, open, open, open);
  // @ts-expect-error step 2 of 6 cannot read a number
  pipe(integer(), add, word, open, open, open, open);
  // @ts-expect-error step 3 of 6 cannot read a number
  pipe(integer(), add, add, word, open, open, open);
  // @ts-expect-error step 4 of 6 cannot read a number
  pipe(integer(), add, add, add, word, open, open);
  // @ts-expect-error step 5 of 6 cannot read a number
  pipe(integer(), add, add, add, add, word, open);
  // @ts-expect-error step 6 of 6 cannot read a number
  pipe(integer(), add, add, add, add, add, word);
  // @ts-expect-error step 1 of 7 cannot read a number
  pipe(integer(), word, open, open, open, open, open, open);
  // @ts-expect-error step 2 of 7 cannot read a number
  pipe(integer(), add, word, open, open, open, open, open);
  // @ts-expect-error step 3 of 7 cannot read a number
  pipe(integer(), add, add, word, open, open, open, open);
  // @ts-expect-error step 4 of 7 cannot read a number
  pipe(integer(), add, add, add, word, open, open, open);
  // @ts-expect-error step 5 of 7 cannot read a number
  pipe(integer(), add, add, add, add, word, open, open);
  // @ts-expect-error step 6 of 7 cannot read a number
  pipe(integer(), add, add, add, add, add, word, open);
  // @ts-expect-error step 7 of 7 cannot read a number
  pipe(integer(), add, add, add, add, add, add, word);
  // @ts-expect-error step 1 of 8 cannot read a number
  pipe(integer(), word, open, open, open, open, open, open, open);
  // @ts-expect-error step 2 of 8 cannot read a number
  pipe(integer(), add, word, open, open, open, open, open, open);
  // @ts-expect-error step 3 of 8 cannot read a number
  pipe(integer(), add, add, word, open, open, open, open, open);
  // @ts-expect-error step 4 of 8 cannot read a number
  pipe(integer(), add, add, add, word, open, open, open, open);
  // @ts-expect-error step 5 of 8 cannot read a number
  pipe(integer(), add, add, add, add, word, open, open, open);
  // @ts-expect-error step 6 of 8 cannot read a number
  pipe(integer(), add, add, add, add, add, word, open, open);
  // @ts-expect-error step 7 of 8 cannot read a number
  pipe(integer(), add, add, add, add, add, add, word, open);
  // @ts-expect-error step 8 of 8 cannot read a number
  pipe(integer(), add, add, add, add, add, add, add, word);
});

test("a rejection a promise answers comes back as the rejecting stage's object", async () => {
  const rejection = { issues: [{ message: 'Expected x.' }] };
  const rejectsLater = async () => {
    await Promise.resolve();
    return rejection;
  };
  await expect(pipe(text(), rejectsLater)['~standard'].validate('y')).resolves.toBe(rejection);
});
