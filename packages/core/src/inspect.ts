import type { ArgumentSlot, BuiltCommand } from './command.js';
import { isPlainObject } from './facts.js';
import type { BuiltGlobals } from './globals.js';
import type { compileOptions } from './options.js';
import type { ArgumentConfig, OptionConfig } from './types.js';
import type { InputDeclaration, OptionInput } from './validation.js';
import { validatesOmission } from './validation.js';

/** One declared argument. `default` wraps the declared value, so an explicit `undefined` shows. */
interface ArgumentNode {
  readonly name: string;
  readonly description: string | undefined;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly validated: boolean;
  readonly validateOmitted: boolean;
  readonly default: { readonly value: unknown } | undefined;
}

/** One declared option, in the shape its type gives it. Spellings are the accepted CLI forms. */
type OptionNode =
  | {
      readonly type: 'string';
      readonly name: string;
      readonly description: string | undefined;
      readonly long: string | null;
      readonly short: string | null;
      readonly required: boolean;
      readonly multiple: boolean;
      readonly validated: boolean;
      readonly validateOmitted: boolean;
      readonly default: { readonly value: unknown } | undefined;
    }
  | {
      readonly type: 'boolean';
      readonly name: string;
      readonly description: string | undefined;
      readonly long: string | null;
      readonly short: string | null;
      readonly negative: string | null;
      readonly polarity: 'positive' | 'negative' | 'both';
    };

/**
 * One Command in the graph. `name` is `null` for the root, and `path` is its route from it.
 * `aliases` holds the hidden aliases in declaration order, so a Command appears once, under its
 * canonical name, and `path` never holds an alias. The root reports the Application's description,
 * so a projection that walks nodes never special-cases it.
 */
interface CommandNode {
  readonly name: string | null;
  readonly aliases: readonly string[];
  readonly path: readonly string[];
  readonly description: string | undefined;
  readonly hasAction: boolean;
  readonly arguments: readonly ArgumentNode[];
  readonly options: readonly OptionNode[];
  readonly children: readonly CommandNode[];
}

/**
 * One built graph as plain data. The globals appear once here and in no `CommandNode`. `version`
 * and `description` are the Application's own core facts, and `undefined` where it declares none.
 */
interface CommandGraph {
  readonly name: string;
  readonly version: string | undefined;
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
 * A snapshot of one declared value. Arrays and plain objects are copied and frozen to any depth, so
 * a consumer cannot reach the declaration through the graph, and a later call reports the declared
 * value again. Primitives and library objects are reported as they are.
 */
function snapshot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry: unknown) => snapshot(entry)));
  }
  if (isPlainObject(value)) {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshot(entry)])),
    );
  }
  return value;
}

/** A declared default is wrapped, so `default: undefined` reads apart from no default at all. */
function declaredDefault(config: ArgumentConfig | OptionConfig) {
  return 'default' in config ? Object.freeze({ value: snapshot(config.default) }) : undefined;
}

function optionNode(input: OptionInput, table: ReturnType<typeof compileOptions>): OptionNode {
  const { config, name } = input;
  const { long, negative, short } = spellingsOf(table, name);
  const node: OptionNode =
    config.type === 'boolean'
      ? {
          description: config.description,
          long,
          name,
          negative,
          polarity: config.polarity ?? 'positive',
          short,
          type: 'boolean',
        }
      : {
          default: declaredDefault(config),
          description: config.description,
          long,
          // The parser reads the same test, so a collection reports as one here and there.
          multiple: config.multiple === true,
          name,
          required: config.required === true,
          short,
          type: 'string',
          validateOmitted: validatesOmission(input),
          validated: config.validate !== undefined,
        };
  return Object.freeze(node);
}

/** The built slots already answer presence and arity, so the node repeats no config reading. */
function argumentNode(slot: ArgumentSlot): ArgumentNode {
  const { config, name } = slot.input;
  const node: ArgumentNode = {
    default: declaredDefault(config),
    description: config.description,
    name,
    required: slot.required,
    validateOmitted: validatesOmission(slot.input),
    validated: config.validate !== undefined,
    variadic: slot.variadic,
  };
  return Object.freeze(node);
}

function optionNodes(
  inputs: readonly InputDeclaration[],
  table: ReturnType<typeof compileOptions>,
) {
  return Object.freeze(
    inputs.filter((input) => input.kind === 'option').map((input) => optionNode(input, table)),
  );
}

/**
 * One Command as frozen plain data. A child reports the description its own declaration carries,
 * and the root reports the Application's, which is why the caller supplies that one.
 */
function commandNode(
  command: BuiltCommand,
  path: readonly string[],
  description: string | undefined = command.description,
): CommandNode {
  const node: CommandNode = {
    aliases: Object.freeze([...command.aliases]),
    arguments: Object.freeze(command.arguments.map((slot) => argumentNode(slot))),
    children: Object.freeze(
      [...command.children].map(([name, child]) =>
        commandNode(child, Object.freeze([...path, name])),
      ),
    ),
    description,
    hasAction: command.dispatch !== undefined,
    name: command.name,
    options: optionNodes(command.inputs, command.options),
    path,
  };
  return Object.freeze(node);
}

/** Renders one built graph as frozen plain data. Nothing here reads a host fact or a schema. */
function inspectGraph(
  name: string,
  graph: { globals: BuiltGlobals; root: BuiltCommand },
  facts: { description: string | undefined; version: string | undefined },
): CommandGraph {
  const inspected: CommandGraph = {
    description: facts.description,
    globals: optionNodes(graph.globals.inputs, graph.globals.options),
    name,
    root: commandNode(graph.root, Object.freeze([]), facts.description),
    version: facts.version,
  };
  return Object.freeze(inspected);
}

export type { ArgumentNode, CommandGraph, CommandNode, OptionNode };
export { inspectGraph };
