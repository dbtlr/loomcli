import { readExtension } from '@loomcli/core';
import type { CommandGraph, CommandNode, OptionNode } from '@loomcli/core';

import { mcpInput } from './extension.js';

/** Which options a tool exposes and which the author keeps off every call. */

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

export { excluded, excludedNames, exposed };
