import { DeclarationError } from '@loomcli/core';
import type {
  CommandGraph,
  CommandNode,
  GraphBuiltHook,
  OptionGroup,
  OptionNode,
} from '@loomcli/core';

import {
  mcpPropertyNameTaken,
  mcpRequiredInputExcluded,
  mcpToolNameTaken,
  mcpToolNeedsTerminal,
  mcpToolWithoutAction,
} from '../rules.js';
import { excluded, requiredInCall } from './exposure.js';
import { propertiesOf, toolEntries } from './tools.js';
import type { Property } from './tools.js';

/** A Command as a sentence that opens with it names it: its quoted path, or the root Command. */
function opening(command: CommandNode): string {
  const [first] = command.path;
  return first === undefined ? 'The root Command' : `Command "${command.path.join(' ')}"`;
}

/**
 * The pair of Commands in a name collision, the earlier in graph order first. The root comes first
 * in graph order, so only the earlier can be the root, when a child is named like the application.
 */
function pair(earlier: CommandNode, later: CommandNode): string {
  const [first] = earlier.path;
  if (first === undefined) {
    return `The root Command and Command "${later.path.join(' ')}"`;
  }
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

/** The fault, if any, of a required local option that the author excluded from the tool. */
function requiredFault(command: CommandNode): DeclarationError | undefined {
  const option = command.options.find((each) => excluded(each) && requiredInCall(each));
  if (option === undefined) {
    return undefined;
  }
  return new DeclarationError(mcpRequiredInputExcluded, {
    correction: 'Make the option optional, or remove exclude from its mcpInput value.',
    sentence: `${opening(command)} requires option "${option.name}" and excludes it from its MCP tool, which leaves every call without a value.`,
  });
}

/** One name takes the singular noun. */
const singleName = 1;

/** Two names join with `and` alone. */
const pairSize = 2;

/** Option names joined for a sentence: `"a"`, `"a" and "b"`, or `"a", "b", and "c"`. */
function namesOf(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  if (quoted.length <= pairSize) {
    return quoted.join(' and ');
  }
  const last = quoted.pop() ?? '';
  return `${quoted.join(', ')}, and ${last}`;
}

/** The declared options the names name, in their order. */
function nodesOf(command: CommandNode, names: readonly string[]): OptionNode[] {
  return names.flatMap((name) => {
    const option = command.options.find((each) => each.name === name);
    return option === undefined ? [] : [option];
  });
}

/**
 * The fault, if any, of a requirement whose option the tool does not exclude while it excludes an
 * option the requirement needs, so every call that supplies the option fails. A hidden option the
 * tool does not list is still filled from the server's sources, so it counts as not excluded. The
 * sentence names every needed option and the first excluded one.
 */
function requirementFault(
  command: CommandNode,
  group: Extract<OptionGroup, { readonly kind: 'requires' }>,
): DeclarationError | undefined {
  const [option] = nodesOf(command, [group.option]);
  const firstLeft = nodesOf(command, group.requires).find(excluded);
  if (option === undefined || excluded(option) || firstLeft === undefined) {
    return undefined;
  }
  const noun = group.requires.length === singleName ? 'option' : 'options';
  return new DeclarationError(mcpRequiredInputExcluded, {
    correction: `Exclude "${option.name}" from the tool as well, or remove exclude from the mcpInput value of "${firstLeft.name}".`,
    sentence: `${opening(command)} makes option "${option.name}" require ${noun} ${namesOf(group.requires)} and excludes "${firstLeft.name}" from its MCP tool, so a call that supplies "${option.name}" always fails.`,
  });
}

/**
 * The fault, if any, of a group over all its members that no tool call can satisfy: a
 * `oneRequired` group whose every member is excluded, or a `requiredTogether` group that excludes
 * some members and not all.
 */
function memberGroupFault(
  command: CommandNode,
  group: Exclude<OptionGroup, { readonly kind: 'requires' }>,
): DeclarationError | undefined {
  const members = nodesOf(command, group.options);
  const left = members.filter(excluded);
  const [firstLeft] = left;
  const names = namesOf(members.map(({ name }) => name));
  if (group.kind === 'oneRequired' && left.length === members.length) {
    return new DeclarationError(mcpRequiredInputExcluded, {
      correction: 'Remove exclude from the mcpInput value of one of them.',
      sentence: `${opening(command)} requires one of options ${names} and excludes every one from its MCP tool, which leaves every call without a value.`,
    });
  }
  if (
    group.kind === 'requiredTogether' &&
    firstLeft !== undefined &&
    left.length < members.length
  ) {
    return new DeclarationError(mcpRequiredInputExcluded, {
      correction: 'Exclude every option of the group from the tool, or none.',
      sentence: `${opening(command)} requires options ${names} together and excludes "${firstLeft.name}" from its MCP tool, so a call that supplies the rest always fails.`,
    });
  }
  return undefined;
}

/** The fault, if any, of the first option group no tool call can satisfy, in declaration order. */
function groupFault(command: CommandNode): DeclarationError | undefined {
  for (const group of command.optionGroups) {
    const fault =
      group.kind === 'requires'
        ? requirementFault(command, group)
        : memberGroupFault(command, group);
    if (fault !== undefined) {
      return fault;
    }
  }
  return undefined;
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

/** The fault, if any, of an opted-in Command that needs a terminal, which no tool call has. */
function terminalFault(command: CommandNode): DeclarationError | undefined {
  if (!command.needsTerminal) {
    return undefined;
  }
  return new DeclarationError(mcpToolNeedsTerminal, {
    correction: 'Remove mcpCommand, or remove needsTerminal from the Command.',
    sentence: `${opening(command)} carries mcpCommand and needs a terminal, which no tool call has.`,
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
 * an action and needs no terminal, no two give one tool name, no tool lists an argument and an option under one name, and no tool excludes
 * a required local option or what a group needs from every call.
 */
const judgeTools: GraphBuiltHook = (graph) => {
  const named = new Map<string, CommandNode>();
  for (const { command, name } of toolEntries(graph)) {
    const fault =
      actionFault(command) ??
      terminalFault(command) ??
      nameFault(named.get(name), command, name) ??
      propertyFault(graph, command) ??
      requiredFault(command) ??
      groupFault(command);
    if (fault !== undefined) {
      throw fault;
    }
    named.set(name, command);
  }
  return undefined;
};

export { judgeTools };
