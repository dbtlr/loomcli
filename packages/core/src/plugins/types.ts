import type { ArgumentConfig, OptionConfig, Unmarked } from '../inputs/types.js';
import type { CommandGraph, ResultNode } from '../inspection/inspect.js';
import type { ResultView } from '../output/types.js';
import type { ExtensionValue } from './extension.js';

/** Phantom key. It brands the surface a lifecycle hook receives, so a forged value is not one. */
export declare const attachedCommand: unique symbol;

/**
 * One Command as `onCommandAttach` receives it: the facts `inspect()` publishes, with their types
 * erased, and the authoring calls a hook may make. Each call returns a new value whose facts hold
 * what the call added, so a hook reads its own earlier calls back. The calls a hook cannot make are
 * absent, because each of them changes what the action was compiled against or the graph's shape.
 *
 * @public
 * @sealed
 */
export interface AttachedCommand {
  /** Brand that marks a value as the surface core handed the hook, so a forged value is not one. */
  readonly [attachedCommand]: true;
  /** The Command's own name, and `null` for the root. */
  readonly name: string | null;
  /** The Command's route from the root, which is empty for the root. */
  readonly path: readonly string[];
  /** Whether the Command has an action registered. */
  readonly hasAction: boolean;
  /** The declared argument names, in declaration order. */
  readonly arguments: readonly string[];
  /** The declared local option names, in declaration order. */
  readonly options: readonly string[];
  /**
   * The result the Command declares as `inspect()` publishes it, or `null` where it declares none.
   */
  readonly result: ResultNode | null;
  /**
   * The extension record `inspect()` would publish for this Command at this hook: the author's
   * layers, then every value an earlier hook or this hook's earlier `extend()` calls added.
   */
  readonly extensions: Readonly<Record<string, unknown>>;
  /** Declares one more argument and returns a new value that lists it. */
  argument(name: string, config: ArgumentConfig): AttachedCommand;
  /** Declares one more local option and returns a new value that lists it. */
  option(name: string, config: OptionConfig & Unmarked): AttachedCommand;
  /** Declares that at most one of the named local options may be supplied. */
  exclusive(...names: [string, string, ...string[]]): AttachedCommand;
  /** Declares that at least one of the named local options must be supplied. */
  oneRequired(...names: [string, string, ...string[]]): AttachedCommand;
  /** Declares that the named local options are supplied together or not at all. */
  requiredTogether(...names: [string, string, ...string[]]): AttachedCommand;
  /**
   * Reshapes the views of the Command's result: a view under a name the result already holds
   * replaces it in place, and a new name is appended. It returns a new value whose `result` lists
   * them, and `options.default` names the default view.
   */
  views<const Replacements extends Readonly<Record<string, ResultView>>>(
    replacements: Replacements,
    options?: { default?: keyof Replacements & string },
  ): AttachedCommand;
  /**
   * Adds command-targeted extension values and returns a new value whose `extensions` carry them.
   */
  extend(...values: readonly ExtensionValue<'command'>[]): AttachedCommand;
}

/**
 * The lifecycle hook core calls once per Command at graph build, in installation order, each
 * receiving what the previous plugin's hook returned.
 *
 * @public
 */
export type CommandAttachHook = (command: AttachedCommand) => AttachedCommand;

/**
 * The lifecycle hook core calls once per graph build, after every `onCommandAttach` hook, with the
 * frozen graph. It judges the graph and never contributes: it returns nothing, and it rejects the
 * graph by throwing a `DeclarationError`.
 *
 * @public
 */
export type GraphBuiltHook = (graph: CommandGraph) => undefined;
