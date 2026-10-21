import { extension } from '@loomcli/core';
import { boolean, object, optional, string } from 'valibot';

import { packageName } from '../constants.js';
import { prose } from '../lines.js';

/**
 * The MCP plugin's facts, as declarations alone. A Command opts in as a tool by carrying an
 * `mcpCommand` value, and an input's `mcpInput` or `mcpArgument` value words its property for an
 * agent. They ship apart from the plugin's entry, so a Command library opts in without importing the
 * server, and they name no protocol type.
 */

/**
 * The hints a tool carries about its effects. The author owns them and Loom never verifies or
 * infers one, so an unset hint stays unset and the protocol's own default applies.
 */
const annotations = object({
  destructive: optional(boolean()),
  idempotent: optional(boolean()),
  openWorld: optional(boolean()),
  readOnly: optional(boolean()),
});

/** Opts a Command in as a tool, with its description for an agent and its effect hints. */
export const mcpCommand = extension(`${packageName}/mcp/command`, {
  schema: object({ annotations: optional(annotations), description: optional(prose) }),
  target: 'command',
});

/** An option's description for an agent, in place of its core description. */
export const mcpInput = extension(`${packageName}/mcp/input`, {
  schema: object({ description: string() }),
  target: 'option',
});

/** An argument's description for an agent, in place of its core description. */
export const mcpArgument = extension(`${packageName}/mcp/argument`, {
  schema: object({ description: string() }),
  target: 'argument',
});
