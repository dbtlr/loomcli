import { extension } from '@loomcli/core';
import { z } from 'zod';

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
const annotations = z.object({
  destructive: z.boolean().optional(),
  idempotent: z.boolean().optional(),
  openWorld: z.boolean().optional(),
  readOnly: z.boolean().optional(),
});

/** Opts a Command in as a tool, with its description for an agent and its effect hints. */
export const mcpCommand = extension(`${packageName}/mcp/command`, {
  schema: z.object({ annotations: annotations.optional(), description: prose.optional() }),
  target: 'command',
});

/** An option's description for an agent, in place of its core description. */
export const mcpInput = extension(`${packageName}/mcp/input`, {
  schema: z.object({ description: z.string() }),
  target: 'option',
});

/** An argument's description for an agent, in place of its core description. */
export const mcpArgument = extension(`${packageName}/mcp/argument`, {
  schema: z.object({ description: z.string() }),
  target: 'argument',
});
