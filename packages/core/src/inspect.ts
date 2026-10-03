import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

import type { ArgumentSlot, BuiltCommand, BuiltGraph } from './command.js';
import { asSentence, DeclarationError, InternalError, reasonOf } from './errors.js';
import type { ExtensionRecords } from './extension.js';
import { partOf, siteFinding } from './facts.js';
import type { InputSite } from './facts.js';
import { schemaConverterFailed } from './input-rules.js';
import type { OptionSpelling } from './options.js';
import { isPlainObject, snapshotRecord } from './plain.js';
import { foreignGraph, foreignGraphCorrection } from './rules.js';
import type { ArgumentConfig, DeclaredResult, OptionConfig } from './types.js';
import type { InputDeclaration, OptionInput } from './validation.js';
import { declarationSubject, declaringSite, inputPlace, validatesOmission } from './validation.js';

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
 * One declared option, in the shape its type gives it. Spellings are the accepted CLI forms. A
 * global option reads the same whether the application or a plugin declared it, and an option a
 * plugin's lifecycle hook declared on a Command is that Command's own in every respect, so neither
 * names a plugin.
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
function spellingsOf(table: ReadonlyMap<string, OptionSpelling>, name: string): Spellings {
  const spellings: Spellings = { long: null, negative: null, short: null };
  for (const [spelling, option] of table) {
    if (option.name === name) {
      spellings[option.role] = spelling;
    }
  }
  return spellings;
}

/**
 * A declared default is wrapped, so `default: undefined` reads apart from no default at all. The
 * value is the frozen snapshot the declaring call took, the one a run validates, so inspection
 * copies nothing and every reader sees one value.
 */
function declaredDefault(config: ArgumentConfig | OptionConfig) {
  return 'default' in config ? Object.freeze({ value: config.default }) : undefined;
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
 * How one build treats a converter that fails, and where the inputs it reads sit. A development
 * build reports the failure as a declaration fault at the input's call; a distributed one reads the
 * input's schema as `null`.
 */
interface SchemaCheck {
  readonly development: boolean;
  /** The call that declared one input, which a converter fault marks. */
  readonly siteOf: (input: InputDeclaration) => InputSite | undefined;
}

/**
 * The converter fault a development build reports for one input, with the way it failed and, when
 * the converter threw, the thrown value as its cause.
 */
function converterFault(
  input: InputDeclaration,
  check: SchemaCheck,
  failed: { failure: string; cause?: unknown },
) {
  const site = check.siteOf(input);
  const parts = {
    correction:
      'Fix the converter so it returns a JSON Schema object, or declare a validator that publishes none.',
    findings: site === undefined ? [] : [siteFinding(site, partOf(site, 'validate'))],
    sentence: `${declarationSubject(input)} validator's JSON Schema converter ${failed.failure}`,
  };
  return 'cause' in failed
    ? new DeclarationError(schemaConverterFailed, parts, { cause: failed.cause })
    : new DeclarationError(schemaConverterFailed, parts);
}

/**
 * The input-side schema a declaration's validator publishes, snapshotted the way a declared
 * default is, or `null` where the graph holds no published shape: no validator, a validator with
 * no converter, or, in a distributed build, a converter that throws or returns anything but a plain
 * object. A development build reports that last case as a declaration fault instead.
 */
function inputSchema(input: InputDeclaration, check: SchemaCheck): InputSchema {
  const { config } = input;
  const schema = 'validate' in config ? config.validate : undefined;
  if (schema === undefined) {
    return null;
  }
  let copied: Readonly<Record<string, unknown>> | undefined = undefined;
  // The converter is the library's code from the first property read to the last key of its answer.
  // A throw on reaching it, on calling it, or on reading what it answered is one failure.
  try {
    if (!publishesSchema(schema)) {
      return null;
    }
    const published: unknown = schema['~standard'].jsonSchema.input(schemaTarget);
    copied = isPlainObject(published) ? snapshotRecord(published) : undefined;
  } catch (error) {
    if (check.development) {
      throw converterFault(input, check, {
        cause: error,
        failure: `failed for target "${schemaTarget.target}": ${asSentence(reasonOf(error))}`,
      });
    }
    return null;
  }
  if (copied !== undefined) {
    return copied;
  }
  if (check.development) {
    throw converterFault(input, check, {
      failure: `answered target "${schemaTarget.target}" with a value that is not a plain object.`,
    });
  }
  return null;
}

/** One declaration's extension record, which is the shared empty one when it carries no value. */
function extensionsOf(records: ExtensionRecords, declaration: object) {
  return records.get(declaration) ?? noExtensions;
}

/** The registers one list of options is read under. */
interface OptionScope {
  check: SchemaCheck;
  records: ExtensionRecords;
  table: ReadonlyMap<string, OptionSpelling>;
}

function optionNode(input: OptionInput, read: OptionScope): OptionNode {
  const { check, records, table } = read;
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
          schema: inputSchema(input, check),
          short,
          type: 'string',
          validateOmitted: validatesOmission(input),
          validated: config.validate !== undefined,
        };
  return Object.freeze(node);
}

/** The built slots already answer presence and arity, so the node repeats no config reading. */
function argumentNode(
  slot: ArgumentSlot,
  read: { check: SchemaCheck; records: ExtensionRecords },
): ArgumentNode {
  const { check, records } = read;
  const { config, name } = slot.input;
  const node: ArgumentNode = {
    default: declaredDefault(config),
    description: config.description,
    extensions: extensionsOf(records, slot.input),
    name,
    required: slot.required,
    schema: inputSchema(slot.input, check),
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
  place: {
    description?: string | undefined;
    development: boolean;
    nodes: WeakMap<BuiltCommand, CommandNode>;
    path: readonly string[];
    records: ExtensionRecords;
  },
): CommandNode {
  const { development, nodes, path, records } = place;
  const check: SchemaCheck = {
    development,
    siteOf: (input) => declaringSite(input, inputPlace(input, path)),
  };
  const node: CommandNode = {
    aliases: Object.freeze([...command.aliases]),
    arguments: Object.freeze(
      command.arguments.map((slot) => argumentNode(slot, { check, records })),
    ),
    children: Object.freeze(
      [...command.children].map(([name, child]) =>
        commandNode(child, { development, nodes, path: Object.freeze([...path, name]), records }),
      ),
    ),
    deprecated: command.deprecated,
    description: 'description' in place ? place.description : command.description,
    extensions: command.extensions,
    hasAction: command.dispatch !== undefined,
    hidden: command.hidden,
    name: command.name,
    options: Object.freeze(optionNodes(command.inputs, { check, records, table: command.table })),
    path,
    result: resultNode(command.result),
  };
  const frozen = Object.freeze(node);
  nodes.set(command, frozen);
  return frozen;
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
 * Renders one built graph as frozen plain data. Nothing here reads a host fact; each validated
 * input's converter is asked for its input schema, and in a development build a converter that
 * fails is a declaration fault. The globals list holds every global option, the application's own
 * and then each installed plugin's in installation order, which is the order the table holds them.
 */
function inspectGraph(
  name: string,
  graph: BuiltGraph,
  facts: { description: string | undefined; development: boolean; version: string },
): CommandGraph {
  const { development } = facts;
  const records = graph.extensions;
  const table = graph.globals.options;
  const nodes = new WeakMap<BuiltCommand, CommandNode>();
  const { sites } = graph.globals;
  const check: SchemaCheck = { development, siteOf: (input) => sites.get(input) };
  const inspected: CommandGraph = {
    description: facts.description,
    globals: Object.freeze(optionNodes(graph.globals.inputs, { check, records, table })),
    name,
    root: commandNode(graph.root, {
      description: facts.description,
      development,
      nodes,
      path: Object.freeze([]),
      records,
    }),
    version: facts.version,
  };
  const frozen = Object.freeze(inspected);
  links.set(frozen, { graph, nodes });
  return frozen;
}

/**
 * The built graph behind one rendered graph, and each built Command's own node in it. The parser
 * reads the built tables, so a reader of the rendered graph that must parse as the parser does
 * reaches them here.
 */
interface GraphLink {
  graph: BuiltGraph;
  nodes: WeakMap<BuiltCommand, CommandNode>;
}

/** Every graph core rendered, keyed by the frozen object a caller holds. */
const links = new WeakMap<CommandGraph, GraphLink>();

/**
 * The link of one rendered graph. A graph core did not render has none, which is a caller's
 * programming error rather than an invocation fault.
 */
function linkOf(graph: CommandGraph): GraphLink {
  const link = links.get(graph);
  if (!link) {
    throw new InternalError(foreignGraph, {
      cause: undefined,
      correction: 'Pass the graph inspect() returned.',
      sentence: 'The graph was not produced by inspect().',
    });
  }
  return link;
}

/**
 * The defect a graph reports when its nodes disagree with the build it was rendered from, so a
 * node core looked up is missing.
 */
function graphMismatch(sentence: string): InternalError {
  return new InternalError(foreignGraph, {
    cause: undefined,
    correction: foreignGraphCorrection,
    sentence,
  });
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
      throw graphMismatch(`The routed command "${path.join(' ')}" is not in the inspected graph.`);
    }
    node = child;
  }
  return node;
}

export type { ArgumentNode, CommandGraph, CommandNode, OptionNode, ResultNode };
export { graphMismatch, inspectGraph, linkOf, nodeAt, resultNode };
