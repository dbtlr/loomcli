import type { Finding } from '../diagnostics/diagnostic-text.js';
import type { Host } from '../host/types.js';
import type { Content } from '../inputs/content.js';
import type { InputDeclaration } from '../inputs/declarations.js';
import type { ValidatedInputs } from '../inputs/ledger.js';
import type { OptionGroup } from '../inputs/option-groups.js';
import type { SpellingTable } from '../inputs/options.js';
import type { StdinConfig } from '../inputs/types.js';
import type { CommandNode, CommandGraph } from '../inspection/inspect.js';
import type { ActionContext } from '../invocation/types.js';
import type { Log } from '../output/log.js';
import type { Out, OpenResult, DeclaredResult } from '../output/types.js';
import type { DescriptorRegistry, ExtensionRecords } from '../plugins/extension.js';
import type { BuiltPlugin } from '../plugins/plugin.js';
import type { BuiltValues, AnyProvider } from '../plugins/providers.js';
import type { ContextualStyle } from '../style/style.js';
import type { BuiltGlobals } from './globals.js';
import type { Declared } from './state.js';
/** The named key states the rule, so a rejected declaration name reads as its own diagnostic. */
interface LiteralNameFault {
  /** The text of the diagnostic a rejected declaration name shows. */
  'Declaration names must be one literal string': never;
}

/** A local option name cannot repeat a key the globals already own; the key names the fault. */
export type GlobalNameConstraint<Name extends string, Globals> = Name extends keyof Globals
  ? { 'This option name is already declared as a global option': Name }
  : unknown;

/** A required record key excludes open strings; distribution rejects each union member. */
export type NameConstraint<Name extends string, Whole extends string = Name> =
  {} extends Record<Name, unknown>
    ? LiteralNameFault
    : Name extends Whole
      ? [Whole] extends [Name]
        ? unknown
        : LiteralNameFault
      : LiteralNameFault;

/** One positional slot: the declaration it fills and whether it takes the remaining tokens. */
export interface ArgumentSlot {
  input: InputDeclaration;
  required: boolean;
  variadic: boolean;
}

/**
 * What one dispatch hands its action. `graph` and `command` are the run's inspected graph and the
 * routed node inside it, the values its middleware read. Each builds on its first read, so a run
 * whose action reads neither, whose chain is empty, and which asks no configuration source renders
 * no graph and calls no converter.
 */
export interface DispatchInput {
  cancel: () => void;
  onShutdown: ActionContext<unknown>['onShutdown'];
  onSuspend: ActionContext<unknown>['onSuspend'];
  onResume: ActionContext<unknown>['onResume'];
  interactive: boolean;
  supplied: ActionContext<unknown>['supplied'];
  stdin: Content | undefined;
  command: () => CommandNode;
  graph: () => CommandGraph;
  style: ContextualStyle;
  host: Host;
  /** Runs another Command of this run's graph by name, which the action receives as `invoke`. */
  invoke: ActionContext<unknown>['invoke'];
  /** The action's `log`, bound to no plugin. */
  log: Log;
  /** The action's channel, whose `results` accepts whatever the routed declaration named. */
  out: Out<OpenResult>;
  passthrough: string[];
  /** The values core built for the routed Command's opt-ins, under each provider's name. */
  provided: BuiltValues;
  signal: AbortSignal;
  values: ValidatedInputs;
}

/**
 * One child a bare token reaches, under its canonical name or one of its aliases.
 * `name` repeats the key `children` holds, because `BuiltCommand.name` is `string | null` for the
 * root and the routed path a child extends holds strings alone.
 */
export interface RoutedChild {
  command: BuiltCommand;
  name: string;
}

/**
 * A group registers no action, so its `dispatch` is `undefined` and selection rejects it.
 * `children` is keyed by canonical name, so every candidate list and every walk of the graph reads
 * it, and `routes` adds the aliases, so routing alone resolves them.
 */
export interface BuiltCommand {
  passthrough: { description: string | undefined } | undefined;
  optionGroups: readonly OptionGroup[];
  stdin: (StdinConfig & { readonly position: number }) | undefined;
  /** Every alias, visible ones included, in the order the Command's calls declared them. */
  aliases: readonly string[];
  /** The visible aliases, in the order `aliases` holds them. */
  visibleAliases: readonly string[];
  arguments: readonly ArgumentSlot[];
  /**
   * The identity of the plugin whose `onCommandAttach` hook declared each of this Command's inputs
   * a hook declared, which that plugin's middleware reads under `ownOptions`.
   */
  attachedBy: ReadonlyMap<InputDeclaration, string>;
  children: ReadonlyMap<string, BuiltCommand>;
  /** The plugin whose lifecycle hook declared each input a hook declared, by its identity. */
  declarers: ReadonlyMap<InputDeclaration, string>;
  deprecated: string | undefined;
  description: string | undefined;
  dispatch: ((input: DispatchInput) => unknown) | undefined;
  extensions: Readonly<Record<string, unknown>>;
  hidden: boolean;
  inputs: readonly InputDeclaration[];
  name: string | null;
  /** Whether the action needs a terminal, which a `needsTerminal()` call declared. */
  needsTerminal: boolean;
  /** The providers the action reads, which core builds at the dispatch boundary. */
  uses: readonly AnyProvider[];
  /**
   * The call that attached this Command, opening with the whole path to its parent, or nothing for
   * the root, which no call attaches.
   */
  placement: Finding | undefined;
  /**
   * The one table the parser reads this Command's words against, built after every lifecycle hook
   * ran: its own options, hook-declared ones included, and every global option. Each entry names
   * one declaration, and a group's table holds its own options too, which routing reads there.
   */
  table: SpellingTable;
  /** The result the Command declares, or nothing where it declares none. */
  /** The built declaration is the shape the write site reads, so the channel carries it. */
  result: DeclaredResult | undefined;
  routes: ReadonlyMap<string, RoutedChild>;
}

/**
 * The private handle one graph node is reached through, without its inferred declaration types:
 * what attach and the Application's walk read, and the build that compiles the node.
 */
export interface CommandNodeHandle {
  readonly declared: Declared;
  readonly hasAction: boolean;
  readonly name: string;
  build(context: BuildContext): BuiltCommand;
}

/**
 * One attached child, under the canonical name its parent's namespace holds it by, with the call
 * that attached it, which a diagnostic about the child as a whole marks.
 */
export interface AttachedChild {
  readonly name: string;
  readonly node: CommandNodeHandle;
  readonly placement: Finding;
}

/**
 * One graph build's shared state. `globals` compiles once and every Command reads it. The build is
 * a depth-first walk in attachment order.
 */
export interface BuildContext {
  descriptors: DescriptorRegistry;
  extensions: ExtensionRecords;
  globals: BuiltGlobals;
  /** The route from the root to the Command being built, which a lifecycle hook reads. */
  path: readonly string[];
  /** The call that attached the Command being built, or nothing for the root. */
  placement: Finding | undefined;
  /** The installed plugins in installation order, whose hooks run over every Command. */
  plugins: readonly BuiltPlugin[];
}
