/*
 * Each pack extension publishes its schema as a Standard Schema over an exported facts interface.
 * A value that holds every field the interface names passes the descriptor's call, and its schema
 * outputs every field, so the interface and the schema behind it agree.
 */
import { EX_DATAERR, FatalError } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';
import { configInput } from '@loomcli/plugins/config/extension';
import type { ConfigInputFacts } from '@loomcli/plugins/config/extension';
import { helpArgument, helpCommand, helpInput } from '@loomcli/plugins/help/extension';
import type {
  HelpArgumentFacts,
  HelpCommandFacts,
  HelpInputFacts,
} from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import type {
  ManifestCommandFacts,
  ManifestCommandInput,
} from '@loomcli/plugins/manifest/extension';
import { mcpArgument, mcpCommand, mcpInput } from '@loomcli/plugins/mcp/extension';
import type {
  McpArgumentFacts,
  McpCommandFacts,
  McpInputFacts,
} from '@loomcli/plugins/mcp/extension';
import { expect, expectTypeOf, test } from 'vite-plus/test';

import type { inputFactsSchema as configInputSchema } from '../src/config/facts-schemas.js';
import type {
  argumentFactsSchema as helpArgumentSchema,
  commandFactsSchema as helpCommandSchema,
  inputFactsSchema as helpInputSchema,
} from '../src/help/facts-schemas.js';
import type { commandFactsSchema as manifestCommandSchema } from '../src/manifest/facts-schemas.js';
import type {
  argumentFactsSchema as mcpArgumentSchema,
  commandFactsSchema as mcpCommandSchema,
  inputFactsSchema as mcpInputSchema,
} from '../src/mcp/facts-schemas.js';

/** The schema's output for a value, or the thrown sentences of its issues. */
async function validated<Input, Output>(
  schema: StandardSchemaV1<Input, Output>,
  value: Input,
): Promise<Output> {
  const result = await schema['~standard'].validate(value);
  if (result.issues !== undefined) {
    throw new Error(result.issues.map((issue) => issue.message).join(' '));
  }
  return result.value;
}

test('help keeps every field its facts interfaces name', async () => {
  const command: Required<HelpCommandFacts> = {
    commandSections: [['Work'], ['Work', 'Read']],
    details: 'Read **one** value.',
    examples: [{ command: 'get name', note: 'A top-level key.' }],
    optionSections: [['Output']],
    section: ['Work', 'Read'],
  };
  const input: Required<HelpInputFacts> = {
    accepts: 'A dotted path.',
    hideBindings: true,
    placeholder: 'path',
    section: ['Output'],
  };
  const argument: Required<HelpArgumentFacts> = { accepts: 'A dotted path.' };

  expect(() => helpCommand(command)).not.toThrow();
  expect(() => helpInput(input)).not.toThrow();
  expect(() => helpArgument(argument)).not.toThrow();
  await expect(validated(helpCommand.schema, command)).resolves.toEqual(command);
  await expect(validated(helpInput.schema, input)).resolves.toEqual(input);
  await expect(validated(helpArgument.schema, argument)).resolves.toEqual(argument);
});

test('the manifest reads each declared failure from its class', async () => {
  // The schema reads the class's statics alone, so the test never constructs one.
  class MissingError extends FatalError {
    static override readonly code = 'missing';
    static override readonly exitCode = EX_DATAERR;

    constructor() {
      super('Nothing is at the path.');
      this.name = 'MissingError';
    }
  }
  const input: Required<ManifestCommandInput> = {
    details: 'Quote a path that holds a shell metacharacter.',
    examples: [{ command: 'get name' }],
    failures: [{ failure: MissingError, meaning: 'Nothing is at the path.' }],
  };
  const facts: Required<ManifestCommandFacts> = {
    details: 'Quote a path that holds a shell metacharacter.',
    examples: [{ command: 'get name' }],
    failures: [{ code: 'missing', exitCode: EX_DATAERR, meaning: 'Nothing is at the path.' }],
  };

  expect(() => manifestCommand(input)).not.toThrow();
  await expect(validated(manifestCommand.schema, input)).resolves.toEqual(facts);
});

test('MCP keeps every field its facts interfaces name', async () => {
  const command: Required<McpCommandFacts> = {
    annotations: { destructive: false, idempotent: true, openWorld: false, readOnly: true },
    description: 'Read one value.',
  };
  const argument: Required<McpArgumentFacts> = { description: 'The path to read.' };

  expect(() => mcpCommand(command)).not.toThrow();
  expect(() => mcpArgument(argument)).not.toThrow();
  await expect(validated(mcpCommand.schema, command)).resolves.toEqual(command);
  await expect(validated(mcpArgument.schema, argument)).resolves.toEqual(argument);
  await expect(validated(mcpInput.schema, { description: 'The file.' })).resolves.toEqual({
    description: 'The file.',
  });
  await expect(validated(mcpInput.schema, { exclude: true })).resolves.toEqual({ exclude: true });
});

test('the configuration binding keeps its path', async () => {
  const binding: Required<ConfigInputFacts> = { path: 'limits.maxBytes' };

  expect(() => configInput(binding)).not.toThrow();
  await expect(validated(configInput.schema, binding)).resolves.toEqual(binding);
});

/** A type with `readonly` removed at every depth, so a facts interface compares to a valibot type. */
type Mutable<Type> = Type extends (...args: never[]) => unknown
  ? Type
  : Type extends object
    ? { -readonly [Key in keyof Type]: Mutable<Type[Key]> }
    : Type;

/**
 * Each facts interface is the valibot input and output of the schema behind it, in both directions,
 * ignoring only `readonly`. The descriptors' annotations alone prove the schema fits the interface,
 * so a widened interface would pass them.
 */
test('each facts interface equals its schema in both directions', () => {
  type Input<Schema extends StandardSchemaV1> = Mutable<StandardSchemaV1.InferInput<Schema>>;
  type Output<Schema extends StandardSchemaV1> = Mutable<StandardSchemaV1.InferOutput<Schema>>;

  expectTypeOf<Input<typeof helpCommandSchema>>().toEqualTypeOf<Mutable<HelpCommandFacts>>();
  expectTypeOf<Output<typeof helpCommandSchema>>().toEqualTypeOf<Mutable<HelpCommandFacts>>();
  expectTypeOf<Input<typeof helpInputSchema>>().toEqualTypeOf<Mutable<HelpInputFacts>>();
  expectTypeOf<Output<typeof helpInputSchema>>().toEqualTypeOf<Mutable<HelpInputFacts>>();
  expectTypeOf<Input<typeof helpArgumentSchema>>().toEqualTypeOf<Mutable<HelpArgumentFacts>>();
  expectTypeOf<Output<typeof helpArgumentSchema>>().toEqualTypeOf<Mutable<HelpArgumentFacts>>();
  expectTypeOf<Input<typeof manifestCommandSchema>>().toEqualTypeOf<
    Mutable<ManifestCommandInput>
  >();
  expectTypeOf<Output<typeof manifestCommandSchema>>().toEqualTypeOf<
    Mutable<ManifestCommandFacts>
  >();
  expectTypeOf<Input<typeof mcpCommandSchema>>().toEqualTypeOf<Mutable<McpCommandFacts>>();
  expectTypeOf<Output<typeof mcpCommandSchema>>().toEqualTypeOf<Mutable<McpCommandFacts>>();
  expectTypeOf<Input<typeof mcpInputSchema>>().toEqualTypeOf<Mutable<McpInputFacts>>();
  expectTypeOf<Output<typeof mcpInputSchema>>().toEqualTypeOf<Mutable<McpInputFacts>>();
  expectTypeOf<Input<typeof mcpArgumentSchema>>().toEqualTypeOf<Mutable<McpArgumentFacts>>();
  expectTypeOf<Output<typeof mcpArgumentSchema>>().toEqualTypeOf<Mutable<McpArgumentFacts>>();
  expectTypeOf<Input<typeof configInputSchema>>().toEqualTypeOf<Mutable<ConfigInputFacts>>();
  expectTypeOf<Output<typeof configInputSchema>>().toEqualTypeOf<Mutable<ConfigInputFacts>>();
});
