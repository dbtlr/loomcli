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
