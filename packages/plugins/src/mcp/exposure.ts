import { readExtension } from '@loomcli/core';
import type { CommandGraph, CommandNode, OptionNode } from '@loomcli/core';

import { mcpInput } from './extension.js';

/* Which options a tool exposes, which the author keeps off every call, and which a call must supply. */

/** Whether the author excluded the option from every tool with `mcpInput({ exclude: true })`. */
function excluded(option: OptionNode): boolean {
  return readExtension(option, mcpInput)?.exclude === true;
}

/** An option a tool exposes: neither hidden, a control option, nor excluded. */
function exposed(option: OptionNode): boolean {
  return !option.hidden && !option.control && !excluded(option);
}

/** Every option the Command's tool leaves out of a call: its excluded local options and every excluded global option. */
function excludedNames(graph: CommandGraph, command: CommandNode): readonly string[] {
  return [...command.options, ...graph.globals].filter(excluded).map(({ name }) => name);
}

/**
 * Whether a call must supply the option: a string or content option that is required, a content
 * option with a positive minimum included, or that is required when the run is not interactive,
 * which a tool call never is.
 */
function requiredInCall(option: OptionNode): boolean {
  return (
    (option.type === 'string' || option.type === 'content') &&
    (option.required || option.requiredWhen === 'non-interactive')
  );
}

export { excluded, excludedNames, exposed, requiredInCall };
