import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

import type { ArgumentSlot, BuiltCommand, BuiltGraph } from '../commands/command.js';
import { partOf, siteFinding } from '../diagnostics/facts.js';
import type { InputSite } from '../diagnostics/facts.js';
import { foreignGraph, foreignGraphCorrection } from '../diagnostics/rules.js';
import { asSentence, DeclarationError, InternalError, reasonOf } from '../failures/errors.js';
import { envNames } from '../inputs/bindings.js';
import type { OptionGroup } from '../inputs/option-groups.js';
import { distinctAliases, reportedOf, spellingsOf } from '../inputs/options.js';
import type { OptionSpelling } from '../inputs/options.js';
import { schemaConverterFailed } from '../inputs/rules.js';
import type { ArgumentConfig, OptionConfig } from '../inputs/types.js';
import type { InputDeclaration, OptionInput } from '../inputs/validation.js';
import {
  declarationSubject,
  declaringSite,
  inputPlace,
  validatesOmission,
} from '../inputs/validation.js';
import type { DeclaredResult } from '../output/types.js';
import { noExtensions } from '../plugins/extension.js';
import type { ExtensionRecords } from '../plugins/extension.js';
import type { BuiltSource } from '../plugins/plugin.js';
import { isPlainObject } from '../support/plain.js';

/**
 * The plain JSON Schema a validated input publishes, or `null` where the graph holds no shape.
 *
 * @public
 * @sealed
 */
type InputSchema = Readonly<Record<string, unknown>> | null;

/**
 * One declared argument. `default` wraps the declared value, so an explicit `undefined` shows, and
 * `schema` is the input schema its validator publishes through the Standard JSON Schema converter.
 *
 * @public
 * @sealed
 */
interface ArgumentNode {
  /** `'content'` for a content argument, and absent for any other. */
  readonly type?: 'content';
  /**
   * Whether a content argument is the Command's stdin target. Only a content argument carries it.
   */
  readonly stdin?: boolean;
  /**
   * The fewest sources a variadic content argument accepts, or `undefined` when it declares none.
   * Only a content argument carries it.
   */
  readonly min?: number | undefined;
  /**
   * The most sources a variadic content argument accepts, or `undefined` when it declares none.
   * Only a content argument carries it.
   */
  readonly max?: number | undefined;
  /** The declared name. */
  readonly name: string;
  /** The declared one-line description, or `undefined` when there is none. */
  readonly description: string | undefined;
  /** Whether a value must be supplied. A content argument with a `min` above 0 is required. */
  readonly required: boolean;
  /**
   * `'non-interactive'` when the argument is declared required only in a non-interactive run, and
   * `null` otherwise.
   */
  readonly requiredWhen: 'non-interactive' | null;
  /** Whether the argument takes every remaining positional value. */
  readonly variadic: boolean;
  /** Whether the argument has a validator. A content argument counts as validated. */
  readonly validated: boolean;
  /** Whether an omitted value is still sent to the validator. */
  readonly validateOmitted: boolean;
  /**
   * The input JSON Schema the argument's validator publishes, or `null` where it publishes none.
   */
  readonly schema: InputSchema;
  /**
   * The declared default wrapped, so `default: undefined` reads apart from no default, or
   * `undefined` when none is declared.
   */
  readonly default: { readonly value: unknown } | undefined;
  /**
   * The extension outputs the argument carries, keyed by extension identity. `readExtension()`
   * reads one.
   */
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
 * `env` holds the variables the option's environment binding names, in declaration order, and is
 * empty when it binds none. A multiple string or content option's `envDelimiter` is the delimiter
 * that binding declares, or `null`. A string option's `envAllowEmpty` is `true` when its binding
 * declares the key `true`, under which a defined empty variable supplies the option.
 * `aliases` holds the declared aliases as bare names in declaration order. An alias is
 * unadvertised, so the spellings above are the ones the declared name derives and no listing reads
 * `aliases`; parsing and `locate` read the table, which holds every alias's spellings.
 */
interface StringOptionNode {
  /** Discriminates a string option from the other option kinds. */
  readonly type: 'string';
  /** The declared name. */
  readonly name: string;
  /** The declared one-line description, or `undefined` when there is none. */
  readonly description: string | undefined;
  /** Whether a listing projection omits the option. */
  readonly hidden: boolean;
  /** The declared migration message, or `undefined` when the option is not deprecated. */
  readonly deprecated: string | undefined;
  /** Whether the option controls the invocation rather than feeding the Command's work. */
  readonly control: boolean;
  /** The long spelling the declared name derives, or `null` where the option has none. */
  readonly long: string | null;
  /** The short spelling the declaration gives, or `null` where the option has none. */
  readonly short: string | null;
  /** The declared aliases as bare names, in declaration order. */
  readonly aliases: readonly string[];
  /** Whether a value must be supplied. A content option with a `min` above 0 is required. */
  readonly required: boolean;
  /**
   * `'non-interactive'` when the option is declared required only in a non-interactive run, and
   * `null` otherwise.
   */
  readonly requiredWhen: 'non-interactive' | null;
  /** Whether the option may be given more than once and collects its values. */
  readonly multiple: boolean;
  /** Whether the option has a validator. A content option counts as validated. */
  readonly validated: boolean;
  /** Whether an omitted value is still sent to the validator. */
  readonly validateOmitted: boolean;
  /** The input JSON Schema the option's validator publishes, or `null` where it publishes none. */
  readonly schema: InputSchema;
  /**
   * The variables the option's environment binding names, in declaration order, and none when it
   * binds none.
   */
  readonly env: readonly string[];
  /** The delimiter a multiple option's binding declares, or `null` when it declares none. */
  readonly envDelimiter: string | null;
  /** Whether the binding lets a defined empty variable supply the option. */
  readonly envAllowEmpty: boolean;
  /**
   * The declared default wrapped, so `default: undefined` reads apart from no default, or
   * `undefined` when none is declared.
   */
  readonly default: { readonly value: unknown } | undefined;
  /** The value a bare spelling supplies, or `null` when the option declares none. */
  readonly implied: string | null;
  /** Whether the option carries the background mark, whose value the run reads as its background choice. */
  readonly background: boolean;
  /**
   * The extension outputs the option carries, keyed by extension identity. `readExtension()` reads
   * one.
   */
  readonly extensions: Readonly<Record<string, unknown>>;
}
/**
 * One declared option, a string, content, Boolean, or counted option, told apart by its `type`.
 * `StringOptionNode`'s description above states the facts every kind shares.
 *
 * @public
 * @sealed
 */
type OptionNode =
  | StringOptionNode
  | (Omit<StringOptionNode, 'type' | 'background' | 'envAllowEmpty'> & {
      readonly type: 'content';
      readonly stdin: boolean;
      readonly min: number | undefined;
      readonly max: number | undefined;
    })
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
      readonly interaction: boolean;
      readonly color: boolean;
      readonly polarity: 'positive' | 'negative' | 'both';
      readonly schema: InputSchema;
      readonly env: readonly string[];
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
      readonly verbose: boolean;
      readonly quiet: boolean;
      readonly schema: null;
      readonly env: readonly string[];
      readonly extensions: Readonly<Record<string, unknown>>;
    };

/**
 * One Command in the graph. `name` is `null` for the root, and `path` is its route from it.
 * `aliases` holds the aliases in declaration order, so a Command appears once, under its canonical
 * name, and `path` never holds an alias. The root reports the Application's description, so a
 * projection that walks nodes never special-cases it, and it reads `hidden: false` and
 * `deprecated: undefined`, the two core facts a listing reads on every other node.
 *
 * @public
 * @sealed
 */
interface CommandNode {
  /** The relationships declared over the local options, in declaration order. */
  readonly optionGroups: readonly OptionGroup[];
  /** The Command's declared stdin, present only when the Command declares one. */
  readonly stdin?: Readonly<{ description: string | undefined; required: boolean }>;
  /** The Command's own name, and `null` for the root. */
  readonly name: string | null;
  /** The declared aliases, in declaration order. */
  readonly aliases: readonly string[];
  /** The route from the root through canonical names, which is empty for the root. */
  readonly path: readonly string[];
  /**
   * The declared one-line description, or `undefined` when there is none. The root reports the
   * Application's.
   */
  readonly description: string | undefined;
  /** Whether a listing projection omits the Command. */
  readonly hidden: boolean;
  /** The declared migration message, or `undefined` when the Command is not deprecated. */
  readonly deprecated: string | undefined;
  /** Whether the Command has an action registered. */
  readonly hasAction: boolean;
  /** The result the Command declares, or `null` where it declares none. */
  readonly result: ResultNode | null;
  /** The Command's arguments, in declaration order. */
  readonly arguments: readonly ArgumentNode[];
  /** The Command's local options, in declaration order. The globals appear on the graph. */
  readonly options: readonly OptionNode[];
  /** The child Commands, in authoring order. */
  readonly children: readonly CommandNode[];
  /**
   * The extension outputs the Command carries, keyed by extension identity. `readExtension()` reads
   * one.
   */
  readonly extensions: Readonly<Record<string, unknown>>;
}

/**
 * The result one Command declares: the unit its action emits, the view names in record order, the
 * name of the view core renders when nothing selects another, and the media type each view
 * declares, by view name, `null` where a view declares none.
 *
 * @public
 * @sealed
 */
interface ResultNode {
  /** Whether the action emits one value or rows. */
  readonly kind: 'value' | 'rows';
  /** The names of the result's views, in record order. */
  readonly views: readonly string[];
  /** The name of the view core renders when nothing selects another. */
  readonly default: string;
  /** The media type each view declares, by view name, and `null` where a view declares none. */
  readonly mediaTypes: Readonly<Record<string, string | null>>;
}

/**
 * One built graph as plain data. The globals appear once here and in no `CommandNode`. `version`
 * and `description` are the Application's own core facts. `version` is the declared string, or
 * `0.0.0` when the Application declares none, so it is never `undefined`. `description` stays
 * `undefined` where the Application declares none.
 *
 * @public
 * @sealed
 */
interface CommandGraph {
  /** The Application's name. */
  readonly name: string;
  /** The Application's declared version, or `0.0.0` when it declares none. */
  readonly version: string;
  /** The Application's declared description, or `undefined` when it declares none. */
  readonly description: string | undefined;
  /**
   * Every global option, the Application's own and then each installed plugin's in installation
   * order.
   */
  readonly globals: readonly OptionNode[];
  /** The root Command, whose `children` hold every other Command. */
  readonly root: CommandNode;
  /** The configuration source's published schema, or `null` when no plugin claims the slot. */
  readonly configuration: ConfigurationNode | null;
}

/**
 * The configuration the installed configuration source reads: the input-side JSON Schema its
 * `schema` publishes, or `null` when it declares none or its schema publishes none.
 *
 * @public
 * @sealed
 */
interface ConfigurationNode {
  /**
   * The input-side JSON Schema of the configuration, or `null` when the source declares none or
   * publishes none.
   */
  readonly schema: InputSchema;
}

/**
 * The spelling every reported problem names one option by, the one core's own validation reports:
 * its long form, a negative-only Boolean option's negative form, and otherwise its short form. A
 * plugin that reports a problem for an option, such as an input source, names it this way too.
 *
 * @example
 * ```ts
 * import { Application, reportedSpelling } from '@loomcli/core';
 *
 * const graph = new Application('jsonkit').inspect();
 * const spellings = graph.globals.map((option) => reportedSpelling(option));
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/failures.md#failure-classes
 * @public
 */
export function reportedSpelling(option: OptionNode): string {
  const negative = option.type === 'boolean' ? option.negative : null;
  return reportedOf({ long: option.long, negative, short: option.short }, option.name);
}

/**
 * A declared default is wrapped, so `default: undefined` reads apart from no default at all. The
 * value is the default as declared, the one a run validates, so inspection copies nothing and every
 * reader sees one value.
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

/** How one converter failed: the clause after its subject, and the thrown value when it threw. */
interface FailedConverter {
  readonly failure: string;
  readonly cause?: unknown;
}

/**
 * The converter fault a development build reports for one input, with the finding that marks its
 * validator and the way it failed, with the thrown value as its cause when the converter threw.
 */
function converterFault(input: InputDeclaration, check: SchemaCheck, failed: FailedConverter) {
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
 * The input-side schema a Standard Schema publishes, as its converter returned it, or `null` where
 * it publishes no shape: a schema with no converter, or a converter that throws or returns anything
 * but a plain object. `failed` hears that last case first, in a build that checks converters.
 */
function publishedSchema(
  schema: StandardSchemaV1,
  failed: ((how: FailedConverter) => void) | undefined,
): InputSchema {
  let published: unknown = undefined;
  // The converter is the library's code, so a throw on reaching it or on calling it is one failure.
  try {
    if (!publishesSchema(schema)) {
      return null;
    }
    published = schema['~standard'].jsonSchema.input(schemaTarget);
  } catch (error) {
    const reason = asSentence(reasonOf(error));
    failed?.({ cause: error, failure: `failed for target "${schemaTarget.target}": ${reason}` });
    return null;
  }
  if (isPlainObject(published)) {
    return published;
  }
  failed?.({
    failure: `answered target "${schemaTarget.target}" with a value that is not a plain object.`,
  });
  return null;
}

/**
 * The input-side schema a declaration's validator publishes, or `null` where the graph holds no
 * published shape: no validator, or a validator that publishes none. A build that checks
 * converters reports a converter that fails as a declaration fault at the input's call first.
 */
function inputSchema(input: InputDeclaration, check: SchemaCheck): InputSchema {
  const { config } = input;
  if (config.type === 'content') {
    return Object.freeze({ minLength: 1, type: 'string' });
  }
  const schema = 'validate' in config ? config.validate : undefined;
  if (schema === undefined) {
    return null;
  }
  const { fault } = check;
  return publishedSchema(
    schema,
    fault && ((failed) => fault(converterFault(input, check, failed))),
  );
}

/**
 * The configuration fact: `null` when no installed plugin claims the source slot, and otherwise the
 * input-side schema the source's `schema` publishes, `null` when it declares none or publishes none.
 * A converter that fails publishes `null` in every build with no fault, because the author installed
 * the source to read a configuration, and a part JSON Schema cannot express, such as a `bigint`,
 * must not fail their runs.
 */
function configurationNode(source: BuiltSource | undefined): ConfigurationNode | null {
  if (source === undefined) {
    return null;
  }
  const { schema } = source;
  return Object.freeze({
    schema: schema === undefined ? null : publishedSchema(schema, undefined),
  });
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
    aliases: Object.freeze(distinctAliases(name, config).map(({ alias }) => alias)),
    control: config.control === true,
    deprecated: config.deprecated,
    description: config.description,
    env: Object.freeze([...envNames(config)]),
    extensions: extensionsOf(records, input),
    hidden: config.hidden === true,
    long,
    name,
    short,
  };
  switch (config.type) {
    case 'content':
    case 'string': {
      const value = {
        ...shared,
        default: declaredDefault(config),
        envDelimiter: config.envDelimiter ?? null,
        implied: config.implied ?? null,
        multiple: config.multiple === true,
        required: config.required === true || (config.type === 'content' && (config.min ?? 0) > 0),
        requiredWhen: config.required === 'non-interactive' ? ('non-interactive' as const) : null,
        schema: inputSchema(input, check),
        validateOmitted: validatesOmission(input),
        validated: config.type === 'content' || config.validate !== undefined,
      };
      return config.type === 'content'
        ? Object.freeze({
            ...value,
            max: config.max,
            min: config.min,
            stdin: config.stdin === true,
            type: 'content',
          })
        : Object.freeze({
            ...value,
            background: config.background === true,
            envAllowEmpty: config.envAllowEmpty === true,
            type: 'string',
          });
    }
    case 'boolean': {
      return Object.freeze({
        ...shared,
        color: config.color === true,
        interaction: config.interaction === true,
        negative,
        polarity: config.polarity ?? 'positive',
        schema: null,
        type: 'boolean',
      });
    }
    case 'count': {
      return Object.freeze({
        ...shared,
        quiet: config.quiet === true,
        schema: null,
        type: 'count',
        verbose: config.verbose === true,
      });
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
    ...(config.type === 'content'
      ? { max: config.max, min: config.min, stdin: config.stdin === true, type: 'content' as const }
      : {}),
    default: declaredDefault(config),
    description: config.description,
    extensions: extensionsOf(records, slot.input),
    name,
    required: slot.required || (config.type === 'content' && (config.min ?? 0) > 0),
    requiredWhen: config.required === 'non-interactive' ? 'non-interactive' : null,
    schema: inputSchema(slot.input, check),
    validateOmitted: validatesOmission(slot.input),
    validated: config.type === 'content' || config.validate !== undefined,
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
    optionGroups: Object.freeze([...command.optionGroups]),
    ...(command.stdin !== undefined
      ? {
          stdin: Object.freeze({
            description: command.stdin.description,
            required: command.stdin.required === true,
          }),
        }
      : {}),
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
  facts: {
    converterFault: ConverterFault;
    description: string | undefined;
    source: BuiltSource | undefined;
    version: string;
  },
): CommandGraph {
  const fault = facts.converterFault;
  const records = graph.extensions;
  const table = graph.globals.options;
  const nodes = new WeakMap<BuiltCommand, CommandNode>();
  const { sites } = graph.globals;
  const check: SchemaCheck = { fault, siteOf: (input) => sites.get(input) };
  const globals = Object.freeze(optionNodes(graph.globals.inputs, { check, records, table }));
  const root = commandNode(graph.root, {
    description: facts.description,
    fault,
    nodes,
    path: Object.freeze([]),
    records,
  });
  const inspected: CommandGraph = {
    configuration: configurationNode(facts.source),
    description: facts.description,
    globals,
    name,
    root,
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
function linkOf(graph: CommandGraph, correction = 'Pass the graph inspect() returned.'): GraphLink {
  const link = links.get(graph);
  if (!link) {
    throw new InternalError(foreignGraph, {
      cause: undefined,
      correction,
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

export type {
  ArgumentNode,
  CommandGraph,
  CommandNode,
  ConfigurationNode,
  ConverterFault,
  InputSchema,
  OptionNode,
  ResultNode,
};
export { graphMismatch, inspectGraph, linkOf, nodeAt, resultNode };
