/*
 * Acceptance plan for the configuration fact (docs/core/graph-inspection.md, ADR-0121).
 *
 * The fact is proven when public APIs alone produce these results in the test's process:
 *
 * - The fact. `inspect()` reports `configuration: null` when no installed plugin claims the
 *   configuration source slot, `{ schema: null }` when the source declares no schema or its schema
 *   publishes no converter, and otherwise the input-side JSON Schema its converter returns for
 *   `{ target: 'draft-2020-12' }`, as an input's schema is derived.
 * - A converter that fails. A development `inspect()` and `check()` report
 *   `@loomcli/core/schema-converter-failed` naming the plugin, and a distributed run reads `null`.
 */
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { Application, DeclarationError, extension, plugin } from '../src/index.js';
import type { CommandGraph, Plugin, StandardSchemaV1 } from '../src/index.js';

const configKey = extension('@fixture/config/key', { schema: z.string(), target: 'option' });

/** A source that answers nothing, which these cases never call. */
const load = async () => ({ default: async () => ({}) });

/** A configuration plugin whose source declares the schema given, or none. */
function source(schema?: StandardSchemaV1): Plugin {
  return plugin('@fixture/config', {
    extensions: [configKey],
    source: { binding: configKey, load, ...(schema === undefined ? {} : { schema }) },
  });
}

/** A hand-written Standard Schema whose converter answers with what `answer` returns. */
function converting(answer: (options: unknown) => unknown) {
  const calls: unknown[] = [];
  const standard = {
    jsonSchema: {
      input: (options: unknown) => {
        calls.push(options);
        return answer(options);
      },
      output: () => ({}),
    },
    validate: (value: unknown) => ({ value }),
    vendor: 'fixture',
    version: 1 as const,
  };
  const schema: StandardSchemaV1 = { '~standard': standard };
  return { calls, schema };
}

/** A schema whose converter throws with the reason given. */
function throwingSchema(reason: string): StandardSchemaV1 {
  return converting(() => {
    throw new Error(reason);
  }).schema;
}

/** An application with an action, installing the plugins given. */
function application(...plugins: Plugin[]) {
  return new Application('app', { plugins }).action(() => undefined);
}

const fileSchema = z.object({ retries: z.number().int().optional(), title: z.string().optional() });

test('the graph reads configuration: null when no plugin claims the source slot', () => {
  expect(application().inspect().configuration).toBeNull();
  expect(application(plugin('@fixture/other', {})).inspect().configuration).toBeNull();
});

test("a source's schema publishes its input-side JSON Schema, frozen in a frozen fact", () => {
  const { configuration } = application(source(fileSchema)).inspect();
  expect(configuration).toEqual({
    schema: fileSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
  });
  expect(Object.isFrozen(configuration)).toBe(true);
});

test('a source with no schema, or a schema with no converter, reads schema: null', () => {
  const plain: StandardSchemaV1 = {
    '~standard': { validate: (value) => ({ value }), vendor: 'fixture', version: 1 },
  };
  expect(application(source()).inspect().configuration).toEqual({
    schema: null,
  });
  expect(application(source(plain)).inspect().configuration).toEqual({
    schema: null,
  });
});

test('the converter is asked once per build for the target, and its answer is stored as it returned it', () => {
  const answer = { properties: { title: { type: 'string' } }, type: 'object' };
  const { calls, schema } = converting(() => answer);
  const app = application(source(schema));
  expect(app.inspect().configuration?.schema).toBe(answer);
  expect(calls).toEqual([{ target: 'draft-2020-12' }]);
});

/** The fault a call threw, or `undefined` when it threw none. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

const converterCorrection =
  'Fix the converter so it returns a JSON Schema object, or pass a schema that publishes none.';

test.each([
  [
    'throws',
    () => {
      throw new Error('Transforms cannot be represented.');
    },
    'Plugin "@fixture/config" configuration schema\'s JSON Schema converter failed for target "draft-2020-12": Transforms cannot be represented.',
  ],
  [
    'answers a value that is not a plain object',
    () => [1, 2],
    'Plugin "@fixture/config" configuration schema\'s JSON Schema converter answered target "draft-2020-12" with a value that is not a plain object.',
  ],
])(
  'a converter that %s is a development build fault from inspect() and check()',
  (_case, answer, sentence) => {
    const app = application(source(converting(answer).schema));
    const fault = thrownBy(() => app.inspect());
    expect(fault).toBeInstanceOf(DeclarationError);
    expect(fault).toMatchObject({
      correction: converterCorrection,
      rule: { identity: '@loomcli/core/schema-converter-failed' },
      sentence,
    });
    expect(app.check()).toMatchObject([{ sentence }]);
  },
);

test("check() lists an input's converter fault before the configuration schema's", () => {
  const app = new Application('app', { plugins: [source(throwingSchema('Source.'))] })
    .option('size', { type: 'string', validate: throwingSchema('Input.') })
    .action(() => undefined);
  expect(app.check().map((fault) => fault.sentence)).toEqual([
    'Option "size" validator\'s JSON Schema converter failed for target "draft-2020-12": Input.',
    'Plugin "@fixture/config" configuration schema\'s JSON Schema converter failed for target "draft-2020-12": Source.',
  ]);
});

test('a converter that fails reads schema: null in a distributed run', async () => {
  const seen: CommandGraph[] = [];
  const observer = plugin('@fixture/observer', {
    onGraphBuilt: (graph) => {
      seen.push(graph);
      return undefined;
    },
  });
  const failing = converting(() => {
    throw new Error('No JSON Schema.');
  });
  const app = application(source(failing.schema), observer);
  const process = mockProcess({ argv: [], release: { build: 'distributed' } });
  await app.run({ process });
  expect(process.exitCode ?? 0).toBe(0);
  expect(seen.map((graph) => graph.configuration)).toEqual([{ schema: null }]);
});
