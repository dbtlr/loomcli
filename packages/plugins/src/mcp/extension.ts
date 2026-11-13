import { extension } from '@loomcli/core';
import type { Extension, StandardSchemaV1 } from '@loomcli/core';
import { boolean, check, literal, never, object, optional, pipe, string, union } from 'valibot';

import { packageName } from '../constants.js';
import { exactFacts } from '../exact-facts.js';
import { proseRule } from '../lines.js';

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
  /** Whether the tool may destroy data. Unset, the protocol default applies. */
  readonly destructive?: boolean | undefined;
  /**
   * Whether calling the tool again with the same input has no further effect. Unset, the protocol
   * default applies.
   */
  readonly idempotent?: boolean | undefined;
  /**
   * Whether the tool reaches beyond the application, such as the network. Unset, the protocol
   * default applies.
   */
  readonly openWorld?: boolean | undefined;
  /** Whether the tool changes nothing. Unset, the protocol default applies. */
  readonly readOnly?: boolean | undefined;
}

/**
 * The MCP plugin's facts on a Command that opts in as a tool: its description for an agent, prose
 * whose every line holds a character other than whitespace, and its effect hints.
 *
 * @public
 */
interface McpCommandFacts {
  /** The tool's effect hints. */
  readonly annotations?: McpAnnotations | undefined;
  /** The tool's description for an agent. */
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
  /** The argument's description for an agent, in place of its core description. */
  readonly description: string;
}

const annotations = object({
  destructive: optional(boolean()),
  idempotent: optional(boolean()),
  openWorld: optional(boolean()),
  readOnly: optional(boolean()),
});

const prose = pipe(string(), check(proseRule.test, proseRule.message));

/** The value that describes an option, which never also excludes it. */
const described = object({ description: string(), exclude: optional(never()) });

/** The value that excludes an option, which never also describes it. */
const excluding = object({ description: optional(never()), exclude: literal(true) });

const commandFactsSchema = object({
  annotations: optional(annotations),
  description: optional(prose),
});
const commandFacts = exactFacts<McpCommandFacts>()(commandFactsSchema);

const inputFactsSchema = union([described, excluding]);
const inputFacts = exactFacts<McpInputFacts>()(inputFactsSchema);

const argumentFactsSchema = object({
  description: string(),
});
const argumentFacts = exactFacts<McpArgumentFacts>()(argumentFactsSchema);

/**
 * Opts a Command in as a tool, with its description for an agent and its effect hints.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { mcpCommand } from '@loomcli/plugins/mcp/extension';
 *
 * export const get = new Command('get', {
 *   description: 'Read one value at a path.',
 *   extensions: [mcpCommand({ annotations: { openWorld: false, readOnly: true } })],
 * }).action(async () => {});
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/mcp.md
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
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { mcpInput } from '@loomcli/plugins/mcp/extension';
 *
 * export const get = new Command('get')
 *   .option('file', {
 *     extensions: [mcpInput({ description: 'The JSON document to read.' })],
 *     type: 'string',
 *   })
 *   .option('verbose', { extensions: [mcpInput({ exclude: true })], type: 'count' });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/mcp.md
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
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { mcpArgument } from '@loomcli/plugins/mcp/extension';
 *
 * export const get = new Command('get').argument('path', {
 *   extensions: [mcpArgument({ description: 'A dot-separated path from the document root.' })],
 *   required: true,
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/mcp.md
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
