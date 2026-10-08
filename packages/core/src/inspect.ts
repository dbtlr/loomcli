import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

import type { ArgumentSlot, BuiltCommand, BuiltGraph } from './command.js';
import { asSentence, DeclarationError, InternalError, reasonOf } from './errors.js';
import type { ExtensionRecords } from './extension.js';
import { partOf, siteFinding } from './facts.js';
import type { InputSite } from './facts.js';
import { schemaConverterFailed } from './input-rules.js';
import { reportedOf, spellingsOf } from './options.js';
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
 * deprecated one; parsing binds without reading either. `control` is `true` when the declaration
 * marks the option as controlling the invocation rather than feeding the Command's work, which a
 * projection that lists what a Command needs reads, and core reads nowhere.
 * `schema` is the input schema the validator publishes. A Boolean option and a counted option
 * validate nothing, so their variants carry the field at `null`, and every projection built on the
 * node holds if a later contract lets a Boolean option validate. A counted option has no negative
 * spelling, polarity, default, or validator, so its variant carries none of them. A string option's
 * `implied` is the value a bare spelling supplies, or `null` when it declares none.
 * `env` is the variable the option's environment binding names, or `null` when it binds none.
 * `aliases` holds the declared aliases as bare names in declaration order. An alias is
 * unadvertised, so the spellings above are the ones the declared name derives and no listing reads
 * `aliases`; parsing and `locate` read the table, which holds every alias's spellings.
 */
type OptionNode =
  | {
      readonly type: 'string';
      readonly name: string;
      readonly description: string | undefined;
      readonly hidden: boolean;
      readonly deprecated: string | undefined;
      readonly control: boolean;
      readonly long: string | null;
      readonly short: string | null;
      readonly aliases: readonly string[];
      readonly required: boolean;
      readonly multiple: boolean;
      readonly validated: boolean;
      readonly validateOmitted: boolean;
      readonly schema: InputSchema;
      readonly env: string | null;
      readonly default: { readonly value: unknown } | undefined;
      readonly implied: string | null;
      readonly extensions: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'boolean';
      readonly name: string;
      readonly description: string | undefined;
      readonly hidden: boolean;
      readonly deprecated: string | undefined;
      readonly control: boolean;
      readonly long: string | null;
      readonly short: string | null;
      readonly negative: string | null;
      readonly aliases: readonly string[];
      readonly polarity: 'positive' | 'negative' | 'both';
      readonly schema: InputSchema;
      readonly env: string | null;
      readonly extensions: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'count';
      readonly name: string;
      readonly description: string | undefined;
      readonly hidden: boolean;
      readonly deprecated: string | undefined;
      readonly control: boolean;
      readonly long: string | null;
      readonly short: string | null;
      readonly aliases: readonly string[];
      readonly schema: null;
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
 * The result one Command declares: the unit its action emits, the view names in record order, the
 * name of the view core renders when nothing selects another, and the media type each view
 * declares, by view name, `null` where a view declares none.
 */
interface ResultNode {
  readonly kind: 'value' | 'rows';
  readonly views: readonly string[];
  readonly default: string;
  readonly mediaTypes: Readonly<Record<string, string | null>>;
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

/**
 * The spelling every reported problem names one option by, the one core's own validation reports:
 * its long form, a negative-only Boolean option's negative form, and otherwise its short form. A
 * plugin that reports a problem for an option, such as an input source, names it this way too.
 */
export function reportedSpelling(option: OptionNode): string {
  const negative = option.type === 'boolean' ? option.negative : null;
  return reportedOf({ long: option.long, negative, short: option.short }, option.name);
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
 * What a converter that fails is to one build. A build that checks converters hands the declaration
 * fault at the input's call to it, which a run and `inspect()` throw and `check()` keeps, and the
 * input's schema reads `null` when the build goes on. A distributed build checks none, so a failed
 * converter's schema reads `null` alone.
 */
type ConverterFault = ((fault: DeclarationError) => void) | undefined;

/** How one build treats a converter that fails, and where the inputs it reads sit. */
interface SchemaCheck {
  readonly fault: ConverterFault;
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
 * no converter, or a converter that throws or returns anything but a plain object. A build that
 * checks converters reports that last case as a declaration fault first.
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
    if (check.fault) {
      const reason = asSentence(reasonOf(error));
      const failure = `failed for target "${schemaTarget.target}": ${reason}`;
      check.fault(converterFault(input, check, { cause: error, failure }));
    }
    return null;
  }
  if (copied !== undefined) {
    return copied;
  }
  if (check.fault) {
    const failure = `answered target "${schemaTarget.target}" with a value that is not a plain object.`;
    check.fault(converterFault(input, check, { failure }));
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

/**
 * One option's node, in the shape its kind gives it. Every kind publishes the listing facts and the
 * spellings the declared name derives; a string option adds its value facts, a Boolean option its
 * negative spelling and polarity, and a counted option nothing more.
 */
function optionNode(input: OptionInput, read: OptionScope): OptionNode {
  const { check, records, table } = read;
  const { config, name } = input;
  const { long, negative, short } = spellingsOf(table, name);
  const shared = {
    aliases: Object.freeze([...(config.aliases ?? [])]),
    control: config.control === true,
    deprecated: config.deprecated,
    description: config.description,
    env: config.env ?? null,
    extensions: extensionsOf(records, input),
    hidden: config.hidden === true,
    long,
    name,
    short,
  };
  switch (config.type) {
    case 'string': {
      return Object.freeze({
        ...shared,
        default: declaredDefault(config),
        implied: config.implied ?? null,
        // The parser reads the same test, so a collection reports as one here and there.
        multiple: config.multiple === true,
        required: config.required === true,
        schema: inputSchema(input, check),
        type: 'string',
        validateOmitted: validatesOmission(input),
        validated: config.validate !== undefined,
      });
    }
    case 'boolean': {
      return Object.freeze({
        ...shared,
        negative,
        polarity: config.polarity ?? 'positive',
        schema: null,
        type: 'boolean',
      });
    }
    case 'count': {
      return Object.freeze({ ...shared, schema: null, type: 'count' });
    }
    default: {
      const exhaustive: never = config;
      return exhaustive;
    }
  }
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
    fault: ConverterFault;
    nodes: WeakMap<BuiltCommand, CommandNode>;
    path: readonly string[];
    records: ExtensionRecords;
  },
): CommandNode {
  const { fault, nodes, path, records } = place;
  const check: SchemaCheck = {
    fault,
    siteOf: (input) => declaringSite(input, inputPlace(input, path)),
  };
  const node: CommandNode = {
    aliases: Object.freeze([...command.aliases]),
    arguments: Object.freeze(
      command.arguments.map((slot) => argumentNode(slot, { check, records })),
    ),
    children: Object.freeze(
      [...command.children].map(([name, child]) =>
        commandNode(child, { fault, nodes, path: Object.freeze([...path, name]), records }),
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
    mediaTypes: Object.freeze(Object.fromEntries(result.mediaTypes)),
    views: Object.freeze([...result.views.keys()]),
  });
}

/**
 * Renders one built graph as frozen plain data. Nothing here reads a host fact; each validated
 * input's converter is asked for its input schema, and in a build that checks converters, one that
 * fails is a declaration fault handed to `converterFault`. The globals list holds every global option, the application's own
 * and then each installed plugin's in installation order, which is the order the table holds them.
 */
function inspectGraph(
  name: string,
  graph: BuiltGraph,
  facts: { converterFault: ConverterFault; description: string | undefined; version: string },
): CommandGraph {
  const fault = facts.converterFault;
  const records = graph.extensions;
  const table = graph.globals.options;
  const nodes = new WeakMap<BuiltCommand, CommandNode>();
  const { sites } = graph.globals;
  const check: SchemaCheck = { fault, siteOf: (input) => sites.get(input) };
  const inspected: CommandGraph = {
    description: facts.description,
    globals: Object.freeze(optionNodes(graph.globals.inputs, { check, records, table })),
    name,
    root: commandNode(graph.root, {
      description: facts.description,
      fault,
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

export type { ArgumentNode, CommandGraph, CommandNode, ConverterFault, OptionNode, ResultNode };
export { graphMismatch, inspectGraph, linkOf, nodeAt, resultNode };
