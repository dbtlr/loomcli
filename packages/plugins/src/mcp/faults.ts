import { DeclarationError } from '@loomcli/core';
import type { CommandGraph, CommandNode, GraphBuiltHook } from '@loomcli/core';

import { mcpPropertyNameTaken, mcpToolNameTaken, mcpToolWithoutAction } from '../rules.js';
import { propertiesOf, toolEntries } from './tools.js';
import type { Property } from './tools.js';

/** A Command as a sentence that opens with it names it: its quoted path, or the root Command. */
function opening(command: CommandNode): string {
  const [first] = command.path;
  return first === undefined ? 'The root Command' : `Command "${command.path.join(' ')}"`;
}

/**
 * The pair of Commands in a name collision, the earlier in graph order first. The root's tool is the
 * application name alone and every other tool's name is longer, so the root is never one of them.
 */
function pair(earlier: CommandNode, later: CommandNode): string {
  return `Commands "${earlier.path.join(' ')}" and "${later.path.join(' ')}"`;
}

/** An option as a sentence names it, a global option included. */
function optionSubject(property: Property & { readonly kind: 'option' }): string {
  return `${property.global ? 'global option' : 'option'} "${property.node.name}"`;
}

/** The first argument and listed option that share a name, if any. */
function sharedName(properties: readonly Property[]) {
  for (const argument of properties) {
    if (argument.kind === 'argument') {
      const option = properties.find(
        (each) => each.kind === 'option' && each.node.name === argument.node.name,
      );
      if (option?.kind === 'option') {
        return { argument, option };
      }
    }
  }
  return undefined;
}

/** The fault, if any, of one opted-in Command's inputs. */
function propertyFault(graph: CommandGraph, command: CommandNode): DeclarationError | undefined {
  const shared = sharedName(propertiesOf(graph, command));
  if (shared === undefined) {
    return undefined;
  }
  return new DeclarationError(mcpPropertyNameTaken, {
    correction: 'Rename one of them, or remove mcpCommand.',
    sentence: `${opening(command)} declares argument "${shared.argument.node.name}" and ${optionSubject(shared.option)}, which one MCP tool lists under one name.`,
  });
}

/** The fault, if any, of one opted-in Command alone: a tool needs an action to run. */
function actionFault(command: CommandNode): DeclarationError | undefined {
  if (command.hasAction) {
    return undefined;
  }
  return new DeclarationError(mcpToolWithoutAction, {
    correction: 'Remove mcpCommand, or opt in the Commands under it.',
    sentence: `${opening(command)} carries mcpCommand and registers no action.`,
  });
}

/** The fault, if any, of a tool name an earlier opted-in Command already serves. */
function nameFault(earlier: CommandNode | undefined, command: CommandNode, name: string) {
  if (earlier === undefined) {
    return undefined;
  }
  return new DeclarationError(mcpToolNameTaken, {
    correction: 'Rename one Command, or remove mcpCommand from one of them.',
    sentence: `${pair(earlier, command)} both serve the MCP tool "${name}".`,
  });
}

/**
 * Judges the opted-in Commands of every build, a run that never serves a tool included: each has
 * an action, no two give one tool name, and no tool lists an argument and an option under one name.
 */
const judgeTools: GraphBuiltHook = (graph) => {
  const named = new Map<string, CommandNode>();
  for (const { command, name } of toolEntries(graph)) {
    const fault =
      actionFault(command) ??
      nameFault(named.get(name), command, name) ??
      propertyFault(graph, command);
    if (fault !== undefined) {
      throw fault;
    }
    named.set(name, command);
  }
  return undefined;
};

export { judgeTools };
