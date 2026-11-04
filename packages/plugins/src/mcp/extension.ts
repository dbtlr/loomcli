import { extension } from '@loomcli/core';
import type { Extension, StandardSchemaV1 } from '@loomcli/core';

import { packageName } from '../constants.js';
import { argumentFactsSchema, commandFactsSchema, inputFactsSchema } from './facts-schemas.js';

/**
 * The MCP plugin's facts, as declarations alone. A Command opts in as a tool by carrying an
 * `mcpCommand` value, and an input's `mcpInput` or `mcpArgument` value words its property for an
 * agent. They ship apart from the plugin's entry, so a Command library opts in without importing the
 * server, and they name no protocol type. Each descriptor's published schema is a Standard Schema
 * over the interface it names, so an author's type check loads no validation library's
 * declarations.
 */

/**
 * The hints a tool carries about its effects. The author owns them and Loom never verifies or
 * infers one, so an unset hint stays unset and the protocol's own default applies.
 *
 * @public
 */
interface McpAnnotations {
  readonly destructive?: boolean | undefined;
  readonly idempotent?: boolean | undefined;
  readonly openWorld?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
}

/**
 * The MCP plugin's facts on a Command that opts in as a tool: its description for an agent, prose
 * whose every line holds a character other than whitespace, and its effect hints.
 *
 * @public
 */
interface McpCommandFacts {
  readonly annotations?: McpAnnotations | undefined;
  readonly description?: string | undefined;
}

/**
 * An option's facts for an agent: a description in place of its core description, or its
 * exclusion from every tool, never both.
 *
 * @public
 */
type McpInputFacts =
  | { readonly description: string; readonly exclude?: undefined }
  | { readonly description?: undefined; readonly exclude: true };

/**
 * An argument's facts for an agent: a description in place of its core description.
 *
 * @public
 */
interface McpArgumentFacts {
  readonly description: string;
}

const commandFacts: StandardSchemaV1<McpCommandFacts, McpCommandFacts> = commandFactsSchema;
const inputFacts: StandardSchemaV1<McpInputFacts, McpInputFacts> = inputFactsSchema;
const argumentFacts: StandardSchemaV1<McpArgumentFacts, McpArgumentFacts> = argumentFactsSchema;

/**
 * Opts a Command in as a tool, with its description for an agent and its effect hints.
 *
 * @public
 */
export const mcpCommand: Extension<
  'command',
  StandardSchemaV1<McpCommandFacts, McpCommandFacts>
> = extension(`${packageName}/mcp/command`, {
  schema: commandFacts,
  target: 'command',
});

/**
 * An option's description for an agent, in place of its core description, or its exclusion from
 * every tool. A value holds one of the two, because an excluded option has no property to describe.
 *
 * @public
 */
export const mcpInput: Extension<
  'option',
  StandardSchemaV1<McpInputFacts, McpInputFacts>
> = extension(`${packageName}/mcp/input`, {
  schema: inputFacts,
  target: 'option',
});

/**
 * An argument's description for an agent, in place of its core description.
 *
 * @public
 */
export const mcpArgument: Extension<
  'argument',
  StandardSchemaV1<McpArgumentFacts, McpArgumentFacts>
> = extension(`${packageName}/mcp/argument`, {
  schema: argumentFacts,
  target: 'argument',
});

export type { McpAnnotations, McpArgumentFacts, McpCommandFacts, McpInputFacts };
