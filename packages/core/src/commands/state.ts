import { spelled, elided } from '../diagnostics/diagnostic-text.js';
import type { FactSite } from '../diagnostics/facts.js';
import { DeclarationError } from '../failures/errors.js';
import { commandSubject, commandSentence, quoted } from '../failures/messages.js';
import type { InputDeclaration } from '../inputs/declarations.js';
import type { ValidatedInputs } from '../inputs/ledger.js';
import type { OptionGroup } from '../inputs/option-groups.js';
import type { StdinConfig } from '../inputs/types.js';
import type { Action, StdinContext } from '../invocation/types.js';
import type { ResultView, OpenResult } from '../output/types.js';
import type {
  AdmittedDescriptor,
  ExtensionStore,
  ExtensionSubject,
  DescriptorRegistry,
} from '../plugins/extension.js';
import { storeCommandLayers } from '../plugins/extension.js';
import type { BuiltValues, AnyProvider } from '../plugins/providers.js';
import { readUses } from '../plugins/providers.js';
import { buildCommand } from './build.js';
import type { CommandOptions } from './command.js';
import { isPortableName, portableNameCorrection, constructorFinding } from './declaration.js';
import type { InputRecords } from './globals.js';
import { portableName } from './rules.js';
import type { BuildContext, CommandNodeHandle, AttachedChild } from './types.js';
/**
 * One call of the results lane, in the order it was made. A `result()` or `rows()` call declares
 * the unit, and a `views()` call reshapes the views of whichever declaration it follows.
 */
export type ResultCall = { entries: readonly ViewEntry[] } & (
  | { kind: 'value' | 'rows' }
  | { default: string | undefined; kind: 'views' }
);

/**
 * One entry of a call's `views` record as the call read it, once: the view name, the view, and the
 * media type the view declared, so a later write to the view object changes no fact.
 */
export interface ViewEntry {
  key: string;
  view: ResultView;
  mediaType: string | null;
}

/** The core facts a named Command declares, which its constructor checked. The root carries none. */
export interface CommandFacts {
  deprecated: string | undefined;
  description: string | undefined;
  hidden: boolean;
}

/**
 * Everything one Command declaration holds, each part checked by the call that added it. The
 * transitions below copy it with fields replaced, and the Command and Application builders share
 * them, so one declaration call has one implementation.
 */
export interface CommandState<Args, Options, Globals> {
  /** Present once a `needsTerminal()` call declared that the action needs a terminal. */
  needsTerminal?: true;
  passthrough?: { description: string | undefined };
  optionGroups: readonly OptionGroup[];
  stdin?: StdinConfig & { readonly position: number };
  /**
   * The registered action, with the declared result erased. An action is stored under the widest
   * result, so a handler typed from its own declaration stores here and the channel that carries
   * the result is built for it at dispatch.
   */
  action:
    | Action<
        Args,
        Globals & Options,
        OpenResult,
        StdinContext & { passthrough?: string[] },
        BuiltValues
      >
    | undefined;
  /**
   * Every alias, visible ones included, in the order the `alias()` and `visibleAlias()` calls
   * declared them.
   */
  aliases: readonly string[];
  /** The aliases a `visibleAlias()` call declared, in the order `aliases` holds them. */
  visibleAliases: readonly string[];
  bind: (values: ValidatedInputs) => { args: Args; options: Options };
  children: readonly AttachedChild[];
  /**
   * Every descriptor this declaration's extension values name, by identity. The root's holds the
   * whole Application's: its plugins', its global options', and every attached subtree's.
   */
  descriptors: ReadonlyMap<string, AdmittedDescriptor>;
  /** The extension values of every layer, validated at the call that carried each one. */
  extensions: ExtensionStore;
  facts: CommandFacts;
  inputs: readonly InputDeclaration[];
  name: string | null;
  /** The extension record each input's own call validated. */
  records: InputRecords;
  // Every results-lane call in call order, which build reads as one declaration.
  results: readonly ResultCall[];
  /** The providers the action reads, which core builds at the dispatch boundary. */
  uses: readonly AnyProvider[];
}

/** The untyped part of a declaration, which every attach and build check reads. */
export type Declared = Pick<
  CommandState<unknown, unknown, unknown>,
  | 'aliases'
  | 'children'
  | 'descriptors'
  | 'inputs'
  | 'name'
  | 'records'
  | 'results'
  | 'needsTerminal'
  | 'passthrough'
  | 'stdin'
  | 'optionGroups'
  | 'visibleAliases'
>;

/** How the extension diagnostics of one Command's own layers name it. */
export function layerOf(name: string | null): ExtensionSubject {
  return { phrase: `on ${commandSubject(name)}`, sentence: commandSentence(name) };
}

/**
 * The state every declaration starts from. The unnamed root and each named Command share it. The
 * declaration values arrive checked, because the constructor that read them threw for any fault.
 */
export function freshState<Globals>(declaration: {
  descriptors: ReadonlyMap<string, AdmittedDescriptor>;
  extensions: ExtensionStore;
  facts: CommandFacts;
  name: string | null;
  uses: readonly AnyProvider[] | undefined;
}): CommandState<{}, {}, Globals> {
  return {
    action: undefined,
    aliases: [],
    bind: () => ({ args: {}, options: {} }),
    children: [],
    descriptors: declaration.descriptors,
    extensions: declaration.extensions,
    facts: declaration.facts,
    inputs: [],
    name: declaration.name,
    optionGroups: [],
    records: new Map(),
    results: [],
    uses: Object.freeze([...(declaration.uses ?? [])]),
    visibleAliases: [],
  };
}

/**
 * A named Command's own declaration, checked before the value exists: the name, then the extension
 * values its options carry.
 */
export function namedState<Globals>(
  name: string,
  options: (Omit<CommandOptions, 'uses'> & { uses?: readonly AnyProvider[] }) | undefined,
): { name: string; state: CommandState<{}, {}, Globals> } {
  if (!isPortableName(name)) {
    // The options are read after the name is judged, so the name's finding prints them elided.
    throw new DeclarationError(portableName, {
      correction: portableNameCorrection,
      findings: [
        constructorFinding(name, options === undefined ? undefined : spelled(elided), '0'),
      ],
      sentence: `Command name ${quoted(name)} is invalid.`,
    });
  }
  const site: FactSite = {
    at: '1',
    declaration: { arguments: [name, options], call: 'new Command' },
    subject: commandSentence(name),
  };
  const descriptors: DescriptorRegistry = new Map();
  const extensions = storeCommandLayers({
    descriptors,
    layers: [options?.extensions],
    site: { ...site, at: '1.extensions' },
    subject: layerOf(name),
  });
  return {
    name,
    state: freshState({
      descriptors,
      extensions,
      facts: {
        deprecated: options?.deprecated,
        description: options?.description,
        hidden: options?.hidden ?? false,
      },
      name,
      uses: readUses({ ...site, at: '1.uses' }, options?.uses),
    }),
  };
}

/**
 * Each authored value registers its handle here, so the public value holds no state to reach or
 * replace.
 */
export const nodes = new WeakMap<object, CommandNodeHandle>();

/**
 * The handle one Command value registers, closed over its state. The value itself carries no
 * member that reaches the state, so an attached Command stays final.
 */
export function nodeHandle<Args, Options, Globals>(
  name: string,
  state: CommandState<Args, Options, Globals>,
): CommandNodeHandle {
  return Object.freeze({
    build: (context: BuildContext) => buildCommand(state, context),
    declared: state,
    hasAction: state.action !== undefined,
    name,
  });
}

/** The handle behind a value an author built as a Command, or nothing for any other value. */
export function commandNode(value: unknown): CommandNodeHandle | undefined {
  return typeof value === 'object' && value !== null ? nodes.get(value) : undefined;
}
