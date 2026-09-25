import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

import type { ArgumentSlot, BuiltCommand, BuiltGraph } from './command.js';
import { InternalError } from './errors.js';
import type { ExtensionRecords } from './extension.js';
import { isPlainObject } from './facts.js';
import type { compileOptions } from './options.js';
import type { ArgumentConfig, DeclaredResult, OptionConfig } from './types.js';
import type { InputDeclaration, OptionInput } from './validation.js';
import { validatesOmission } from './validation.js';

/** A declaration that carries no extension value publishes one shared, empty frozen record. */
const noExtensions: Readonly<Record<string, unknown>> = Object.freeze({});

/** The plain JSON Schema a validated input publishes, or `null` where the graph holds no shape. */
type InputSchema = Readonly<Record<string, unknown>> | null;

/**
 * One declared argument. `default` wraps the declared value, so an explicit `undefined` shows, and
 * `schema` is the input schema its validator publishes through the Standard JSON Schema converter.
 */
interface ArgumentNode {
  readonly name: string;
  readonly description: string | undefined;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly validated: boolean;
  readonly validateOmitted: boolean;
  readonly schema: InputSchema;
  readonly default: { readonly value: unknown } | undefined;
  readonly extensions: Readonly<Record<string, unknown>>;
}

/**
 * One declared option, in the shape its type gives it. Spellings are the accepted CLI forms, and
 * `scope` tells an application's own option from a plugin option, which reaches no action. An
 * option a plugin's lifecycle hook declared on a Command is that Command's own in every respect, so
 * it reads `application` and names no plugin.
 * `hidden` is `false` unless the declaration says `true`, and `deprecated` is the declared
 * migration message or `undefined`. A listing projection omits a hidden node and marks a
 * deprecated one; parsing binds without reading either.
 * `schema` is the input schema the validator publishes. A Boolean option validates nothing, so its
 * variant carries the field at `null`, and every projection built on the node holds if a later
 * contract lets it validate.
 * `env` is the variable the option's environment binding names, or `null` when it binds none.
 */
type OptionNode =
  | {
      readonly type: 'string';
      readonly name: string;
      readonly description: string | undefined;
      readonly hidden: boolean;
      readonly deprecated: string | undefined;
      readonly scope: 'application' | 'plugin';
      readonly long: string | null;
      readonly short: string | null;
      readonly required: boolean;
      readonly multiple: boolean;
      readonly validated: boolean;
      readonly validateOmitted: boolean;
      readonly schema: InputSchema;
      readonly env: string | null;
      readonly default: { readonly value: unknown } | undefined;
      readonly extensions: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'boolean';
      readonly name: string;
      readonly description: string | undefined;
      readonly hidden: boolean;
      readonly deprecated: string | undefined;
      readonly scope: 'application' | 'plugin';
      readonly long: string | null;
      readonly short: string | null;
      readonly negative: string | null;
      readonly polarity: 'positive' | 'negative' | 'both';
      readonly schema: InputSchema;
      readonly env: string | null;
      readonly extensions: Readonly<Record<string, unknown>>;
    };

/**
 * One Command in the graph. `name` is `null` for the root, and `path` is its route from it.
 * `aliases` holds the aliases in declaration order, so a Command appears once, under its canonical
 * name, and `path` never holds an alias. The root reports the Application's description, so a
 * projection that walks nodes never special-cases it, and it reads `hidden: false` and
 * `deprecated: undefined`, the two core facts a listing reads on every other node.
 */
interface CommandNode {
  readonly name: string | null;
  readonly aliases: readonly string[];
  readonly path: readonly string[];
  readonly description: string | undefined;
  readonly hidden: boolean;
  readonly deprecated: string | undefined;
  readonly hasAction: boolean;
  readonly result: ResultNode | null;
  readonly arguments: readonly ArgumentNode[];
  readonly options: readonly OptionNode[];
  readonly children: readonly CommandNode[];
  readonly extensions: Readonly<Record<string, unknown>>;
}

/**
 * The result one Command declares: the unit its action emits, the view names in record order, and
 * the name of the view core renders when nothing selects another.
 */
interface ResultNode {
  readonly kind: 'value' | 'rows';
  readonly views: readonly string[];
  readonly default: string;
}

/**
 * One built graph as plain data. The globals appear once here and in no `CommandNode`. `version`
 * and `description` are the Application's own core facts. `version` is the declared string, or
 * `0.0.0` when the Application declares none, so it is never `undefined`. `description` stays
 * `undefined` where the Application declares none.
 */
interface CommandGraph {
  readonly name: string;
  readonly version: string;
  readonly description: string | undefined;
  readonly globals: readonly OptionNode[];
  readonly root: CommandNode;
}

/** The accepted spellings of one option, `null` where the declaration publishes none. */
interface Spellings {
  long: string | null;
  negative: string | null;
  short: string | null;
}

/**
 * Reads the spellings out of the compiled table the parser uses, so inspection cannot report a
 * form the parser does not accept. Each entry carries its own role, so the naming convention has
 * one owner: the table that writes it.
 */
function spellingsOf(table: ReturnType<typeof compileOptions>, name: string): Spellings {
  const spellings: Spellings = { long: null, negative: null, short: null };
  for (const [spelling, option] of table) {
    if (option.name === name) {
      spellings[option.role] = spelling;
    }
  }
  return spellings;
}

/**
 * A snapshot of one value. Arrays and plain objects are copied and frozen to any depth, so a
 * consumer cannot reach the source through the copy, and a later call reports the value again.
 * Primitives and library objects, such as a class instance or a `Date` a schema produced, are
 * reported as they are, because core cannot copy them meaningfully. The graph reads it for a
 * declared value and the chain reads it for the request one middleware holds.
 */
export function snapshot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry: unknown) => snapshot(entry)));
  }
  if (isPlainObject(value)) {
    return snapshotRecord(value);
  }
  return value;
}

/** The snapshot of one plain object, under the record type the caller already established. */
function snapshotRecord(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshot(entry)])),
  );
}

/** A declared default is wrapped, so `default: undefined` reads apart from no default at all. */
function declaredDefault(config: ArgumentConfig | OptionConfig) {
  return 'default' in config ? Object.freeze({ value: snapshot(config.default) }) : undefined;
}

/**
 * The JSON Schema draft build asks every converter for, with no library options. Every converter
 * receives this one object, so it is frozen against a library that writes to its argument.
 */
const schemaTarget: StandardJSONSchemaV1.Options = Object.freeze({ target: 'draft-2020-12' });

/** Whether a validator declares the Standard JSON Schema converter, both sides, beside `validate`. */
function publishesSchema(
  schema: StandardSchemaV1,
): schema is StandardSchemaV1 & StandardJSONSchemaV1 {
  const props: object = schema['~standard'];
  return (
    'jsonSchema' in props &&
    typeof props.jsonSchema === 'object' &&
    props.jsonSchema !== null &&
    'input' in props.jsonSchema &&
    typeof props.jsonSchema.input === 'function' &&
    'output' in props.jsonSchema &&
    typeof props.jsonSchema.output === 'function'
  );
}

/**
 * The input-side schema a declaration's validator publishes, snapshotted the way a declared
 * default is, or `null` where the graph holds no published shape: no validator, a validator with
 * no converter, or a converter that throws or returns anything but a plain object. The contract of
 * 2026-09-19 made that last case a declaration error `inspect()` alone reports; that diagnostic is
 * held while the question of how a run tells development from a distributed application is
 * decided, so it reads `null` on both paths.
 */
function inputSchema(config: ArgumentConfig | OptionConfig): InputSchema {
  const schema = 'validate' in config ? config.validate : undefined;
  if (schema === undefined) {
    return null;
  }
  // The converter is the library's code from the first property read.
  // A throw on reaching it and a throw on calling it are one failure.
  try {
    if (!publishesSchema(schema)) {
      return null;
    }
    const published: unknown = schema['~standard'].jsonSchema.input(schemaTarget);
    return isPlainObject(published) ? snapshotRecord(published) : null;
  } catch {
    return null;
  }
}

/** One declaration's extension record, which is the shared empty one when it carries no value. */
function extensionsOf(records: ExtensionRecords, declaration: object) {
  return records.get(declaration) ?? noExtensions;
}

/** The scope one list of options is read under, with the registers its nodes read from. */
interface OptionScope {
  records: ExtensionRecords;
  scope: 'application' | 'plugin';
  table: ReturnType<typeof compileOptions>;
}

function optionNode(input: OptionInput, { records, scope, table }: OptionScope): OptionNode {
  const { config, name } = input;
  const { long, negative, short } = spellingsOf(table, name);
  const extensions = extensionsOf(records, input);
  const node: OptionNode =
    config.type === 'boolean'
      ? {
          deprecated: config.deprecated,
          description: config.description,
          env: config.env ?? null,
          extensions,
          hidden: config.hidden === true,
          long,
          name,
          negative,
          polarity: config.polarity ?? 'positive',
          schema: null,
          scope,
          short,
          type: 'boolean',
        }
      : {
          default: declaredDefault(config),
          deprecated: config.deprecated,
          description: config.description,
          env: config.env ?? null,
          extensions,
          hidden: config.hidden === true,
          long,
          // The parser reads the same test, so a collection reports as one here and there.
          multiple: config.multiple === true,
          name,
          required: config.required === true,
          schema: inputSchema(config),
          scope,
          short,
          type: 'string',
          validateOmitted: validatesOmission(input),
          validated: config.validate !== undefined,
        };
  return Object.freeze(node);
}

/** The built slots already answer presence and arity, so the node repeats no config reading. */
function argumentNode(slot: ArgumentSlot, records: ExtensionRecords): ArgumentNode {
  const { config, name } = slot.input;
  const node: ArgumentNode = {
    default: declaredDefault(config),
    description: config.description,
    extensions: extensionsOf(records, slot.input),
    name,
    required: slot.required,
    schema: inputSchema(config),
    validateOmitted: validatesOmission(slot.input),
    validated: config.validate !== undefined,
    variadic: slot.variadic,
  };
  return Object.freeze(node);
}

function optionNodes(inputs: readonly InputDeclaration[], read: OptionScope) {
  return inputs.filter((input) => input.kind === 'option').map((input) => optionNode(input, read));
}

/**
 * One Command as frozen plain data. A child reports the description its own declaration carries,
 * and the root reports the Application's, which is why the caller supplies that one.
 */
function commandNode(
  command: BuiltCommand,
  place: { description?: string | undefined; path: readonly string[]; records: ExtensionRecords },
): CommandNode {
  const { path, records } = place;
  const node: CommandNode = {
    aliases: Object.freeze([...command.aliases]),
    arguments: Object.freeze(command.arguments.map((slot) => argumentNode(slot, records))),
    children: Object.freeze(
      [...command.children].map(([name, child]) =>
        commandNode(child, { path: Object.freeze([...path, name]), records }),
      ),
    ),
    deprecated: command.deprecated,
    description: 'description' in place ? place.description : command.description,
    extensions: command.extensions,
    hasAction: command.dispatch !== undefined,
    hidden: command.hidden,
    name: command.name,
    options: Object.freeze(
      optionNodes(command.inputs, { records, scope: 'application', table: command.options }),
    ),
    path,
    result: resultNode(command.result),
  };
  return Object.freeze(node);
}

/** The declared result as plain data, or `null` on a Command that declares none. */
function resultNode(result: DeclaredResult | undefined): ResultNode | null {
  if (!result) {
    return null;
  }
  return Object.freeze({
    default: result.default,
    kind: result.kind,
    views: Object.freeze([...result.views.keys()]),
  });
}

/**
 * Renders one built graph as frozen plain data. Nothing here reads a host fact or a schema. The
 * globals list holds the application's own options, then each installed plugin's in installation
 * order, which is the order the globals table holds them in.
 */
function inspectGraph(
  name: string,
  graph: BuiltGraph,
  facts: { description: string | undefined; version: string },
): CommandGraph {
  const records = graph.extensions;
  const table = graph.globals.options;
  const inspected: CommandGraph = {
    description: facts.description,
    globals: Object.freeze([
      ...optionNodes(graph.globals.inputs, { records, scope: 'application', table }),
      ...graph.globals.plugins.flatMap((installed) =>
        optionNodes(installed.inputs, { records, scope: 'plugin', table }),
      ),
    ]),
    name,
    root: commandNode(graph.root, {
      description: facts.description,
      path: Object.freeze([]),
      records,
    }),
    version: facts.version,
  };
  return Object.freeze(inspected);
}

/**
 * The routed node inside the inspected graph, which routing already proved reachable. A missing
 * segment means the two readings of one graph disagree, so the run stops rather than hand a
 * middleware or a configuration source the wrong Command.
 */
function nodeAt(graph: CommandGraph, path: readonly string[]): CommandNode {
  let node = graph.root;
  for (const name of path) {
    const child = node.children.find((entry) => entry.name === name);
    if (!child) {
      throw new InternalError(
        `The routed command "${path.join(' ')}" is not in the inspected graph.`,
        undefined,
      );
    }
    node = child;
  }
  return node;
}

export type { ArgumentNode, CommandGraph, CommandNode, OptionNode, ResultNode };
export { inspectGraph, nodeAt, resultNode };
