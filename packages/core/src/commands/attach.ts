import type { Finding } from '../diagnostics/diagnostic-text.js';
import { DeclarationError } from '../failures/errors.js';
import { commandSentence, commandSubject } from '../failures/messages.js';
import type { DeclaredResult } from '../output/types.js';
import type { DescriptorRegistry } from '../plugins/extension.js';
import { registerDescriptor } from '../plugins/extension.js';
import { buildResult } from './build.js';
import { pathOf, commandPlacement, aliasFinding } from './declaration.js';
import type { GlobalTable } from './globals.js';
import {
  inputFinding,
  passthroughArguments,
  stdinFinding,
  checkCompiledOptions,
  localScope,
} from './inputs.js';
import { siblingNameTaken, commandWithoutAction, commandAttachedTwice } from './rules.js';
import { commandNode } from './state.js';
import type { Declared, CommandState } from './state.js';
import type { AttachedChild, CommandNodeHandle } from './types.js';
/** One Command a rule judges: the name its sentence reads, and the path its findings open with. */
export interface CommandPlace {
  name: string | null;
  path: readonly string[];
}

/** The parent one attach reads: its place and the children it holds. */
interface AttachParent extends CommandPlace {
  children: readonly AttachedChild[];
}

/** The parent a declaration is, as attach reads it. */
function parentOf(state: Declared): AttachParent {
  return { children: state.children, name: state.name, path: pathOf(state.name) };
}

/** The path one child sits at under its parent. */
function childPath(parent: CommandPlace, child: string): readonly string[] {
  return [...parent.path, child];
}

/**
 * The call that attached one child, opening with the whole path to its parent. The root's attach
 * knew that whole path, so a root child keeps its call, a plugin's `commands` entry included. A
 * named parent's `command()` call knew its own name alone, so the walk rebuilds it under the root.
 */
export function rootedPlacement(parent: CommandPlace, child: AttachedChild): Finding {
  return parent.name === null ? child.placement : commandPlacement(parent.path, child.name);
}

/** The call that attached one child, noted with the child's name. */
function childFinding(entry: AttachedChild): Finding {
  return { ...entry.placement, note: `child "${entry.name}"` };
}

/**
 * One parent's namespace, which every canonical name and alias under it shares. The rule reads the
 * same whichever sibling the author attached first.
 */
function checkSiblings(parent: AttachParent, child: AttachedChild): void {
  const sentence = commandSentence(parent.name);
  const { children } = parent;
  const aliased = (entry: AttachedChild, alias: string): Finding =>
    aliasFinding(
      {
        aliases: entry.node.declared.aliases,
        path: childPath(parent, entry.name),
        visibleAliases: entry.node.declared.visibleAliases,
      },
      alias,
      `alias of child "${entry.name}"`,
    );
  const correction = 'Rename or remove one.';
  const twin = children.find((entry) => entry.name === child.name);
  if (twin) {
    throw new DeclarationError(siblingNameTaken, {
      correction,
      findings: [childFinding(twin), childFinding(child)],
      sentence: `${sentence} attaches two children named "${child.name}".`,
    });
  }
  for (const alias of child.node.declared.aliases) {
    const holder = children.find((entry) => entry.name === alias);
    if (holder) {
      throw new DeclarationError(siblingNameTaken, {
        correction,
        findings: [childFinding(holder), aliased(child, alias)],
        sentence: `${sentence} attaches child "${child.name}" with alias "${alias}", which is also the name of child "${alias}".`,
      });
    }
    const owner = children.find((entry) => entry.node.declared.aliases.includes(alias));
    if (owner) {
      throw new DeclarationError(siblingNameTaken, {
        correction,
        findings: [aliased(owner, alias), aliased(child, alias)],
        sentence: `${sentence} attaches child "${child.name}" with alias "${alias}", which is also an alias of child "${owner.name}".`,
      });
    }
  }
  const owner = children.find((entry) => entry.node.declared.aliases.includes(child.name));
  if (owner) {
    throw new DeclarationError(siblingNameTaken, {
      correction,
      findings: [aliased(owner, child.name), childFinding(child)],
      sentence: `${sentence} attaches child "${owner.name}" with alias "${child.name}", which is also the name of child "${child.name}".`,
    });
  }
}

/**
 * Where a finished Command is judged: its path, and the call that attached it, which build has none
 * of for the root.
 */
interface FinishedPlace {
  path: readonly string[];
  placement?: Finding;
}

/**
 * A Command without an action is a group, and routing sends an invocation on to one of its
 * children. A group with no children receives an invocation no handler can answer, and arguments,
 * passthrough, or stdin on a group reach no handler either.
 */
function checkGroup(state: Declared, place: FinishedPlace): void {
  const { name } = state;
  if (state.children.length === 0) {
    const { placement } = place;
    throw new DeclarationError(commandWithoutAction, {
      correction: 'Register an action.',
      findings:
        placement === undefined ? [] : [{ ...placement, note: 'no action and no children' }],
      sentence: `${commandSentence(name)} has no action.`,
    });
  }
  const argument = state.inputs.find((input) => input.kind === 'argument');
  if (argument !== undefined) {
    throw new DeclarationError(commandWithoutAction, {
      correction: 'Declare the arguments on the Command that reads them, or register an action.',
      findings: [inputFinding(place.path, argument, 'the first argument')],
      sentence: `${commandSentence(name)} declares arguments but registers no action to receive them.`,
    });
  }
  if (state.passthrough !== undefined) {
    throw new DeclarationError(commandWithoutAction, {
      correction: 'Declare passthrough on the Command that reads it, or register an action.',
      findings: [
        {
          arguments: passthroughArguments(state.passthrough),
          call: 'passthrough',
          mark: '0',
          path: place.path,
        },
      ],
      sentence: `${commandSentence(name)} declares passthrough but registers no action to receive it.`,
    });
  }
  if (state.stdin !== undefined) {
    throw new DeclarationError(commandWithoutAction, {
      correction: 'Declare stdin on the Command that reads it, or register an action.',
      findings: [stdinFinding(place.path, state.stdin)],
      sentence: `${commandSentence(name)} declares stdin but registers no action to receive it.`,
    });
  }
  if (state.needsTerminal === true) {
    throw new DeclarationError(commandWithoutAction, {
      correction:
        'Declare needsTerminal on the Command whose action needs it, or register an action.',
      findings: [{ arguments: [], call: 'needsTerminal', mark: '0', path: place.path }],
      sentence: `${commandSentence(name)} needs a terminal but registers no action.`,
    });
  }
}

/**
 * The rules a finished Command answers, which attach applies to a child and build to the root: a
 * Command without an action is a group. It answers with the resolved result.
 */
export function checkFinished(
  declared: Declared,
  hasAction: boolean,
  place: FinishedPlace,
): DeclaredResult | undefined {
  if (!hasAction) {
    checkGroup(declared, place);
  }
  return buildResult(declared.results);
}

/**
 * The one attach operation `Command.command()`, `Application.command()`, and a plugin's
 * `commands` list share. A Command is an immutable value, so the child is final here: it is checked
 * as a finished Command and against the parent's current children, at any depth. The placement is
 * the call that attached it, which a finding about the child as a whole marks.
 */
export function attach(
  parent: AttachParent,
  node: CommandNodeHandle,
  placement: Finding,
): AttachedChild {
  const { name } = node;
  const child: AttachedChild = { name, node, placement };
  checkFinished(node.declared, node.hasAction, { path: childPath(parent, name), placement });
  checkSiblings(parent, child);
  return child;
}

/** The handle behind a Command value, which the registry of authored Commands holds. */
export function childNode(child: unknown): CommandNodeHandle {
  const node = commandNode(child);
  if (!node) {
    throw new TypeError('Expected a value returned by new Command(name).');
  }
  return node;
}

/** Attaching is a declaration call too, so the receiver keeps the children it already had. */
export function attachChild<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  child: unknown,
): CommandState<Args, Options, Globals> {
  const node = childNode(child);
  const attached = attach(parentOf(state), node, commandPlacement(pathOf(state.name), node.name));
  return { ...state, children: [...state.children, attached] };
}

/** The first place an Application holds one Command value: its parent's name and the attach call. */
export interface ChildOwner {
  name: string | null;
  placement: Finding;
}

/** What an Application holds while a subtree joins it, each register a copy the caller commits. */
interface JoinScope {
  descriptors: DescriptorRegistry;
  /** The first place that claimed each node the Application holds. */
  owners: Map<CommandNodeHandle, ChildOwner>;
  table: GlobalTable;
}

/**
 * Walks one subtree joining an Application, once, for the rules only the Application can judge: one
 * Command value reached through two paths, two distinct descriptors under one identity, and a local
 * option that meets a global option's key, spelling, or variable. A claim is by node identity, and
 * the name serves the diagnostic alone.
 */
function joinSubtree(scope: JoinScope, child: AttachedChild, parent: CommandPlace): void {
  const { name, node, placement } = child;
  const owner = scope.owners.get(node);
  if (owner) {
    throw new DeclarationError(commandAttachedTwice, {
      correction: 'Attach a Command value at one point; create a new Command for each placement.',
      findings: [
        { ...owner.placement, note: 'the first placement' },
        { ...placement, note: 'the second placement' },
      ],
      sentence: `${commandSentence(parent.name)} attaches child "${name}", which ${commandSubject(owner.name)} also attaches.`,
    });
  }
  scope.owners.set(node, { name: parent.name, placement });
  for (const [key, descriptor] of node.declared.descriptors) {
    registerDescriptor(scope.descriptors, descriptor, { identity: key });
  }
  const path = childPath(parent, name);
  checkCompiledOptions(node.declared.inputs, scope.table, localScope(name, path));
  for (const entry of node.declared.children) {
    const rooted = { ...entry, placement: rootedPlacement({ name, path }, entry) };
    joinSubtree(scope, rooted, { name, path });
  }
}

/**
 * Attaches one child to an Application's root and walks the subtree it brings, once. The scope's
 * registers are copies: the caller commits the owners, and the returned root holds the descriptors.
 */
export function attachToRoot<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  child: { node: CommandNodeHandle; placement: Finding },
  scope: JoinScope,
): CommandState<Args, Options, Globals> {
  const parent = parentOf(state);
  const attached = attach(parent, child.node, child.placement);
  joinSubtree(scope, attached, parent);
  return { ...state, children: [...state.children, attached], descriptors: scope.descriptors };
}

/** Every attached Command's local options against a globals table that has just grown. */
function checkAttachedOptions(
  table: GlobalTable,
  parent: CommandPlace,
  children: readonly AttachedChild[],
): void {
  for (const { name, node } of children) {
    const path = childPath(parent, name);
    checkCompiledOptions(node.declared.inputs, table, localScope(name, path));
    checkAttachedOptions(table, { name, path }, node.declared.children);
  }
}

/**
 * A declaration's own options and every attached Command's, against a globals table that has just
 * grown. The table's new option reads as the other side of any collision.
 */
export function checkDeclaredOptions(state: Declared, table: GlobalTable): void {
  const place: CommandPlace = { name: state.name, path: pathOf(state.name) };
  checkCompiledOptions(state.inputs, table, localScope(place.name, place.path));
  checkAttachedOptions(table, place, state.children);
}
