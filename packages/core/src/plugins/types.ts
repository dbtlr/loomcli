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
 */
export interface AttachedCommand {
  readonly [attachedCommand]: true;
  /** The Command's own name, and `null` for the root. */
  readonly name: string | null;
  readonly path: readonly string[];
  readonly hasAction: boolean;
  /** The declared argument names, in declaration order. */
  readonly arguments: readonly string[];
  /** The declared local option names, in declaration order. */
  readonly options: readonly string[];
  readonly result: ResultNode | null;
  /**
   * The extension record `inspect()` would publish for this Command at this hook: the author's
   * layers, then every value an earlier hook or this hook's earlier `extend()` calls added.
   */
  readonly extensions: Readonly<Record<string, unknown>>;
  argument(name: string, config: ArgumentConfig): AttachedCommand;
  option(name: string, config: OptionConfig & Unmarked): AttachedCommand;
  exclusive(...names: [string, string, ...string[]]): AttachedCommand;
  oneRequired(...names: [string, string, ...string[]]): AttachedCommand;
  requiredTogether(...names: [string, string, ...string[]]): AttachedCommand;
  views<const Replacements extends Readonly<Record<string, ResultView>>>(
    replacements: Replacements,
    options?: { default?: keyof Replacements & string },
  ): AttachedCommand;
  extend(...values: readonly ExtensionValue<'command'>[]): AttachedCommand;
}

/**
 * The lifecycle hook core calls once per Command at graph build, in installation order, each
 * receiving what the previous plugin's hook returned.
 */
export type CommandAttachHook = (command: AttachedCommand) => AttachedCommand;

/**
 * The lifecycle hook core calls once per graph build, after every `onCommandAttach` hook, with the
 * frozen graph. It judges the graph and never contributes: it returns nothing, and it rejects the
 * graph by throwing a `DeclarationError`.
 */
export type GraphBuiltHook = (graph: CommandGraph) => undefined;
