import { readExtension } from '@loomcli/core';
import type { ArgumentNode, CommandGraph, CommandNode, OptionNode } from '@loomcli/core';

import { isPlainJson } from '../plain-data.js';
import { mcpArgument, mcpCommand, mcpInput } from './extension.js';

/**
 * The tool table: which Commands are tools, what each is called, and the inputs each lists, all
 * derived from the graph where it is read. The build-fault hook and the `mcp` action each derive
 * it, so neither stores what the other read.
 */

/** A JSON Schema as plain data, the form a graph fact and a tool's input schema both take. */
type Schema = Readonly<Record<string, unknown>>;

/** One input a tool lists under its declared name: an argument, or an option the tool exposes. */
type Property =
  | { readonly kind: 'argument'; readonly node: ArgumentNode }
  | { readonly kind: 'option'; readonly node: OptionNode; readonly global: boolean };

/** One Command that serves a tool, under the tool's name. */
interface ToolEntry {
  readonly name: string;
  readonly command: CommandNode;
}

/** The effect hints the protocol reads, in its own words. */
interface ToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

/** One tool as the listing shows it. */
interface ListedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: { readonly type: 'object' } & Schema;
  readonly annotations?: ToolAnnotations;
}

/** Every Command under `command`, itself first, depth first in authoring order. */
function walk(command: CommandNode): readonly CommandNode[] {
  return [command, ...command.children.flatMap(walk)];
}

/**
 * A tool's name: the application name and then the Command's path, joined by `_`, with each `-`
 * written as `_`, so the root serves the application name alone. A portable name holds nothing else
 * the protocol's tool names exclude.
 */
function toolName(graph: CommandGraph, command: CommandNode): string {
  return [graph.name, ...command.path].join('_').replaceAll('-', '_');
}

/** Every Command that carries an `mcpCommand` value, in graph order, under its tool name. */
function toolEntries(graph: CommandGraph): readonly ToolEntry[] {
  return walk(graph.root)
    .filter((command) => readExtension(command, mcpCommand) !== undefined)
    .map((command) => ({ command, name: toolName(graph, command) }));
}

/** An option a tool exposes: neither hidden nor a control option. */
function exposed(option: OptionNode): boolean {
  return !option.hidden && !option.control;
}

/**
 * The inputs a Command's tool lists: its arguments in declaration order, then its local options in
 * authoring order, then every global option in graph order, minus hidden and control options.
 */
function propertiesOf(graph: CommandGraph, command: CommandNode): readonly Property[] {
  return [
    ...command.arguments.map((node) => ({ kind: 'argument' as const, node })),
    ...command.options
      .filter(exposed)
      .map((node) => ({ global: false, kind: 'option' as const, node })),
    ...graph.globals
      .filter(exposed)
      .map((node) => ({ global: true, kind: 'option' as const, node })),
  ];
}

/**
 * A description for an agent, opened by a deprecation's migration message where there is one, then
 * a line break and the rest.
 */
function described(
  description: string | undefined,
  deprecated: string | undefined,
): string | undefined {
  if (deprecated === undefined) {
    return description;
  }
  const notice = `Deprecated: ${deprecated}`;
  return description === undefined ? notice : `${notice}\n${description}`;
}

/** A published schema without its top-level `$schema` key, whose dialect the protocol's matches. */
function withoutDialect(schema: Schema): Schema {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema'));
}

/** Several values of one schema, as a multiple option or a variadic argument takes them. */
function listOf(items: Schema): Schema {
  return { type: 'array', items };
}

/** The schema of one value the input takes: the published one, or one derived from its kind. */
function valueSchema(property: Property): Schema {
  const { node } = property;
  if (node.schema !== null) {
    return withoutDialect(node.schema);
  }
  if (property.kind === 'option' && property.node.type === 'boolean') {
    return { type: 'boolean' };
  }
  if (property.kind === 'option' && property.node.type === 'count') {
    return { type: 'integer', minimum: 0 };
  }
  return { type: 'string' };
}

/** Whether the input takes several values. */
function takesSeveral(property: Property): boolean {
  if (property.kind === 'argument') {
    return property.node.variadic;
  }
  return property.node.type === 'string' && property.node.multiple;
}

/** The input's description for an agent: its extension value's, or else its core description. */
function propertyDescription(property: Property): string | undefined {
  if (property.kind === 'argument') {
    return readExtension(property.node, mcpArgument)?.description ?? property.node.description;
  }
  const { node } = property;
  return described(readExtension(node, mcpInput)?.description ?? node.description, node.deprecated);
}

/** The input's declared default, when it is plain JSON data. */
function propertyDefault(property: Property): { readonly default: unknown } | undefined {
  const { node } = property;
  if (!('default' in node) || node.default === undefined || !isPlainJson(node.default.value)) {
    return undefined;
  }
  return { default: node.default.value };
}

/**
 * One property of a tool's input schema: the value's schema, wrapped as an array for several
 * values, with the description and default the plugin sets in place of any the converter wrote.
 */
function propertySchema(property: Property): Schema {
  const value = valueSchema(property);
  const description = propertyDescription(property);
  return {
    ...(takesSeveral(property) ? listOf(value) : value),
    ...(description === undefined ? {} : { description }),
    ...propertyDefault(property),
  };
}

/** Whether the tool requires the input: a required argument or a required local option. */
function isRequired(property: Property): boolean {
  if (property.kind === 'argument') {
    return property.node.required;
  }
  return !property.global && property.node.type === 'string' && property.node.required;
}

/** The object a tool's arguments form, keyed by each listed input's declared name. */
function inputSchema(properties: readonly Property[]): ListedTool['inputSchema'] {
  const required = properties.filter(isRequired).map(({ node }) => node.name);
  const [firstRequired] = required;
  return {
    type: 'object',
    properties: Object.fromEntries(
      properties.map((each) => [each.node.name, propertySchema(each)]),
    ),
    ...(firstRequired === undefined ? {} : { required }),
    additionalProperties: false,
  };
}

/** The hints the author set, in the protocol's words. An unset hint is left out. */
function annotationsOf(command: CommandNode): ToolAnnotations | undefined {
  const hints = readExtension(command, mcpCommand)?.annotations;
  const projected: ToolAnnotations = {
    ...(hints?.readOnly === undefined ? {} : { readOnlyHint: hints.readOnly }),
    ...(hints?.destructive === undefined ? {} : { destructiveHint: hints.destructive }),
    ...(hints?.idempotent === undefined ? {} : { idempotentHint: hints.idempotent }),
    ...(hints?.openWorld === undefined ? {} : { openWorldHint: hints.openWorld }),
  };
  const [anyHint] = Object.keys(projected);
  return anyHint === undefined ? undefined : projected;
}

/** One tool as the listing shows it: its name, description, input schema, and hints. */
function listedTool(graph: CommandGraph, entry: ToolEntry): ListedTool {
  const { command, name } = entry;
  const description = described(
    readExtension(command, mcpCommand)?.description ?? command.description,
    command.deprecated,
  );
  const annotations = annotationsOf(command);
  return {
    name,
    ...(description === undefined ? {} : { description }),
    inputSchema: inputSchema(propertiesOf(graph, command)),
    ...(annotations === undefined ? {} : { annotations }),
  };
}

export { listedTool, propertiesOf, toolEntries };
export type { ListedTool, Property, ToolEntry };
