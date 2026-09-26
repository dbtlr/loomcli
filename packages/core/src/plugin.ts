import { checkEnvBinding, claimVariables } from './bindings.js';
import type { MiddlewareContext } from './chain.js';
import { attach, commandNode } from './command.js';
import type { AttachedChild, Command } from './command.js';
import { DeclarationError, InternalError, reasonOf } from './errors.js';
import { appliesTo, buildExtensions, isDescriptor, registerDescriptor } from './extension.js';
import type { AnyExtension, DescriptorRegistry } from './extension.js';
import { checkDeprecated, checkDescription, checkHidden, isPlainObject } from './facts.js';
import { boundOptions } from './globals.js';
import type { InputRecords } from './globals.js';
import type { OptionNode } from './inspect.js';
import { coreViews } from './lanes.js';
import { booleanValue, compileOptions } from './options.js';
import type { OptionValues } from './options.js';
import { isProcessSignal } from './signals.js';
import type { ProcessSignal } from './signals.js';
import type { Palette } from './style-state.js';
import type { ThemeConstraint, ThemeMapping } from './style.js';
import { buildTheme } from './theme.js';
import type { CommandAttachHook, Host, OptionValue, PluginOptionConfig } from './types.js';
import { captureConfig, checkDeclarations } from './validation.js';
import type { InputDeclaration, OptionInput } from './validation.js';
import { buildViews, viewIdentities } from './view.js';
import type { ViewContribution } from './view.js';

/**
 * The declaration record a plugin contributes its options under: the parsing part of an option
 * config, keyed by option name. A plugin option carries no schema and no presence rule, so the
 * config type publishes neither, and `plugin()` repeats the rule for a JavaScript author.
 */
type PluginOptions = Readonly<Record<string, PluginOptionConfig>>;

/** The values one plugin's own options take, read through the same rules an action's options are. */
type PluginOptionValues<Options extends PluginOptions> = {
  readonly [Name in keyof Options]: OptionValue<Options[Name]>;
};

/** Phantom key. It carries a plugin's declared options in a read position and holds no value. */
declare const pluginOptions: unique symbol;
declare const pluginTheme: unique symbol;

/**
 * One plugin's declarations as `plugin()` receives them, with the generic parts erased. The call
 * reads every one of them defensively, because a JavaScript author reaches the same slots, so the
 * erased shape is what the rules below read and no declaration is claimed to be well formed here.
 */
interface DeclaredPlugin {
  theme?: unknown;
  options?: PluginOptions;
  middleware?: { activate?: unknown; load?: unknown };
  onCommandAttach?: unknown;
  extensions?: readonly AnyExtension[];
  views?: unknown;
  signals?: unknown;
  source?: unknown;
  commands?: unknown;
}

/** Authored values register here, so the public type publishes no state to reach or replace. */
const nodes = new WeakMap<object, BuiltPlugin>();

/**
 * The runtime value `plugin()` returns. `Options` appears in a read position alone, which makes it
 * covariant: a `plugins` list holds plugins with different options the way `views` holds
 * overrides for different keys, and `Middleware` and `load` accept a narrower plugin.
 */
class PluginDeclaration<Options extends PluginOptions, Theme extends ThemeMapping> {
  declare readonly [pluginTheme]: Theme;
  declare readonly [pluginOptions]: () => Options;

  constructor(node: BuiltPlugin) {
    nodes.set(this, node);
    Object.freeze(this);
  }
}

/**
 * One plugin, as the opaque value `plugin()` returns. The declarations behind it stay private to
 * this package, so no consumer can read or replace them.
 */
type Plugin<Options extends PluginOptions = PluginOptions, Theme extends ThemeMapping = {}> = Pick<
  PluginDeclaration<Options, Theme>,
  typeof pluginOptions | typeof pluginTheme
>;

/** The declared options of a plugin, or of the factory that returns one. */
type OptionsOf<Contributor> =
  Contributor extends Plugin<infer Options>
    ? Options
    : Contributor extends (...args: never[]) => Plugin<infer Options>
      ? Options
      : PluginOptions;

/** A middleware reads its own plugin's options and either takes over or continues the chain. */
type Middleware<Contributor extends Plugin | ((...args: never[]) => Plugin)> = (
  context: MiddlewareContext<OptionsOf<Contributor>>,
) => Promise<void> | void;

/**
 * What a configuration source receives: the host, its own plugin's option values, resolved from
 * argv, the environment, and their defaults, and the `OptionNode` of every option core asks about.
 */
interface SourceContext<Options extends PluginOptions = PluginOptions> {
  readonly host: Host;
  readonly options: PluginOptionValues<Options>;
  readonly requests: readonly OptionNode[];
}

/**
 * One answer: a value of the option's raw type, a string, a Boolean, or a list of strings for a
 * multiple option, and the one-line label core prints in a diagnostic about the value.
 */
interface SourceAnswer {
  readonly value: string | boolean | readonly string[];
  readonly label: string;
}

/**
 * A configuration source answers the requested options by declared name. A requested option with
 * no key in the record has no answer and falls through to its default.
 */
type SourceResolver<Contributor extends Plugin | ((...args: never[]) => Plugin)> = (
  context: SourceContext<OptionsOf<Contributor>>,
) => Promise<Readonly<Record<string, SourceAnswer>>>;

/**
 * Everything a plugin declares. `plugin()` checks every rule the definition carries on its own, and
 * creating and installing the value runs none of its code: a hook runs at graph build, the
 * middleware runs inside an invocation, and the configuration source runs in the input-source
 * stage when an unfilled option carries its binding.
 */
interface PluginDefinition<
  Options extends PluginOptions = PluginOptions,
  Theme extends ThemeMapping = ThemeMapping,
> {
  theme?: Theme & ThemeConstraint<Theme>;
  options?: Options;
  middleware?: {
    activate: 'always' | readonly (keyof Options & string)[];
    load: () => Promise<{ default: Middleware<Plugin<Options>> }>;
  };
  onCommandAttach?: CommandAttachHook;
  extensions?: readonly AnyExtension[];
  views?: readonly ViewContribution[];
  signals?: readonly ('SIGINT' | 'SIGTERM')[];
  source?: {
    binding: AnyExtension & { readonly target: 'option' };
    load: () => Promise<{ default: SourceResolver<Plugin<Options>> }>;
  };
  commands?: readonly Command<unknown, unknown>[];
}

/**
 * One plugin: an identity and the contributions it carries. Creating and installing the value runs
 * none of its code: a hook runs at graph build, and the middleware runs inside an invocation, so an
 * installed plugin an invocation never reaches costs that invocation its hooks alone. Every rule
 * that one definition carries on its own throws here, before the value exists.
 */
function plugin<Options extends PluginOptions = {}, const Theme extends ThemeMapping = {}>(
  identity: string,
  definition: PluginDefinition<Options, Theme>,
): Plugin<NoInfer<Options>, NoInfer<Theme>> {
  const captured = {
    ...definition,
    ...(definition?.theme === undefined
      ? {}
      : { theme: isPlainObject(definition.theme) ? { ...definition.theme } : definition.theme }),
  };
  return new PluginDeclaration<Options, Theme>(
    readPlugin(identity, isPlainObject(definition) ? captured : definition),
  );
}

/** How every plugin diagnostic names one plugin at the start of a sentence. */
function pluginSentence(identity: string): string {
  return `Plugin "${identity}"`;
}

/** Reads the declarations behind an installed value; anything else is a declaration error. */
function nodeOf(value: unknown): BuiltPlugin {
  const node = typeof value === 'object' && value !== null ? nodes.get(value) : undefined;
  if (!node) {
    throw new DeclarationError(
      'The Application holds a value that is not a plugin. Supply the value returned by plugin(identity, definition).',
    );
  }
  return node;
}

/** The identity one plugin declares, which is a nonempty string. */
function readIdentity(identity: unknown): string {
  if (typeof identity !== 'string') {
    throw new DeclarationError(
      'A plugin declares an identity that is not a string. Supply a nonempty string, such as the package name.',
    );
  }
  if (identity === '') {
    throw new DeclarationError(
      'A plugin declares an empty identity. Supply a nonempty string, such as the package name.',
    );
  }
  return identity;
}

/** The declarations one plugin value carries, which a JavaScript author reaches as any value. */
function definitionOf(identity: string, definition: DeclaredPlugin): DeclaredPlugin {
  if (!isPlainObject(definition)) {
    throw new DeclarationError(
      `${pluginSentence(identity)} declares a definition that is not an object. Supply { options, middleware, extensions, views }.`,
    );
  }
  return definition;
}

/** What the installed list resolves to: the plugins in order, and every descriptor they define. */
interface InstalledPlugins {
  descriptors: DescriptorRegistry;
  plugins: readonly BuiltPlugin[];
}

/**
 * The installed list in composition order, with every rule that reads two plugins together: an
 * identity installed twice, a second claim on the theme slot, the signals slot, or the
 * configuration source, and two distinct descriptors under one identity. The slot is read
 * defensively, because a JavaScript author reaches it with any value. Each plugin's own rules
 * already ran at its `plugin()` call.
 */
function installPlugins(plugins: unknown): InstalledPlugins {
  if (!Array.isArray(plugins)) {
    throw new DeclarationError(
      'The Application plugins must be an array. Supply a list of plugin values.',
    );
  }
  const list: readonly unknown[] = plugins;
  const installed = list.map((value) => nodeOf(value));
  const identities = new Set<string>();
  const descriptors: DescriptorRegistry = new Map();
  // Each slot has one owner, so the first plugin to claim it names the second claimant's diagnostic.
  const owners: { signals?: string; source?: string; theme?: string } = {};
  for (const entry of installed) {
    const { identity } = entry;
    if (identities.has(identity)) {
      throw new DeclarationError(
        `The Application installs plugin "${identity}" twice. Install each plugin once.`,
      );
    }
    identities.add(identity);
    if (entry.theme !== undefined) {
      if (owners.theme !== undefined) {
        throw new DeclarationError(
          `${pluginSentence(identity)} claims the theme slot, which plugin "${owners.theme}" already holds. Install one owner.`,
        );
      }
      owners.theme = identity;
    }
    for (const descriptor of entry.descriptors.values()) {
      registerDescriptor(descriptors, descriptor);
    }
    // An empty claim leaves the signals slot free.
    if (entry.signals.length > 0) {
      if (owners.signals !== undefined) {
        throw new DeclarationError(
          `${pluginSentence(identity)} claims the signals slot, which plugin "${owners.signals}" already holds. Install one owner.`,
        );
      }
      owners.signals = identity;
    }
    if (entry.source) {
      if (owners.source !== undefined) {
        throw new DeclarationError(
          `${pluginSentence(identity)} declares a configuration source, which plugin "${owners.source}" already declares. Install one source.`,
        );
      }
      owners.source = identity;
    }
  }
  return { descriptors, plugins: installed };
}

/** The keys a plugin option may not declare, in the order its diagnostic names them. */
const forbidden = ['validate', 'validateOmitted', 'required'] as const;

/** The rules a plugin option answers before every rule an ordinary declaration carries. */
function checkPluginOption(sentence: string, config: PluginOptionConfig): void {
  if (!isPlainObject(config)) {
    throw new DeclarationError(`${sentence} is not an option declaration. Supply { type, ... }.`);
  }
  const rejected = forbidden.find((key) => key in config);
  if (rejected !== undefined) {
    throw new DeclarationError(
      `${sentence} declares ${rejected}. Remove it; a plugin option carries no validator or presence rule, and the middleware interprets the value.`,
    );
  }
  checkDescription(sentence, config.description);
  checkHidden(sentence, config.hidden);
  checkDeprecated(sentence, config.deprecated);
}

/**
 * One plugin's option declarations, in declaration order. They join the globals table, so the rules
 * that pair them with another scope's options belong to that table and not to this reading.
 */
function readOptions(
  identity: string,
  declared: PluginOptions | undefined,
  build: PluginRegisters,
): readonly OptionInput[] {
  if (declared !== undefined && !isPlainObject(declared)) {
    throw new DeclarationError(
      `${pluginSentence(identity)} declares options that are not an object. Supply a record of option declarations.`,
    );
  }
  const inputs: OptionInput[] = [];
  for (const [name, config] of Object.entries(declared ?? {})) {
    const sentence = `${pluginSentence(identity)} option "${name}"`;
    checkPluginOption(sentence, config);
    checkEnvBinding(sentence, config);
    const input: OptionInput = { config: captureConfig(config), kind: 'option', name };
    // The shared rules name the plugin and the option, so a fault reads with its contributor.
    checkDeclarations([input], sentence);
    build.records.set(
      input,
      buildExtensions({
        declared: config.extensions,
        descriptors: build.descriptors,
        subject: {
          phrase: `on ${sentence.slice(0, 1).toLowerCase()}${sentence.slice(1)}`,
          sentence,
        },
        target: 'option',
      }),
    );
    inputs.push(input);
  }
  // Two options of one plugin meet in the one table the pre-scan reads, so they share its rules.
  compileOptions(inputs, `plugin "${identity}"`);
  claimVariables(boundOptions(inputs, (name) => `plugin "${identity}" option "${name}"`));
  return inputs;
}

/** One activation name, which must be one of the plugin's own declared options. */
function readActivationName(identity: string, name: unknown, names: ReadonlySet<string>): string {
  if (typeof name !== 'string' || !names.has(name)) {
    throw new DeclarationError(
      `${pluginSentence(identity)} activates middleware on option "${String(name)}", which it does not declare. Name one of the plugin's own options.`,
    );
  }
  return name;
}

/** The activation a middleware declares, checked against the options its own plugin declares. */
function readActivation(
  identity: string,
  declared: unknown,
  names: ReadonlySet<string>,
): 'always' | readonly string[] {
  if (declared === 'always') {
    return 'always';
  }
  if (!Array.isArray(declared)) {
    throw new DeclarationError(
      `${pluginSentence(identity)} declares middleware with no activation. Supply activate: 'always' or a list of the plugin's own option names.`,
    );
  }
  const list: readonly unknown[] = declared;
  if (list.length === 0) {
    throw new DeclarationError(
      `${pluginSentence(identity)} declares middleware with an empty activation list. Name at least one of the plugin's options or use 'always'.`,
    );
  }
  return list.map((name) => readActivationName(identity, name, names));
}

/**
 * The loader a middleware declares. Core calls it with no arguments and reads whatever it resolves
 * to, so being callable is the whole runtime claim this check makes.
 */
function isLoader(value: unknown): value is () => unknown {
  return typeof value === 'function';
}

/**
 * The default export one plugin loader resolves to, checked by the guard its caller supplies. A
 * loader that throws where it is called and one that rejects later are one failure, and a module
 * without the export names the kind of function it owed, such as `middleware` or `source`.
 */
async function loadDefault<Export>(
  identity: string,
  load: () => unknown,
  owed: { guard: (value: unknown) => value is Export; noun: string },
): Promise<Export> {
  let module: unknown = undefined;
  try {
    module = await load();
  } catch (error) {
    throw new InternalError(`Loading plugin "${identity}" failed: ${reasonOf(error)}`, error);
  }
  const exported: unknown =
    module !== null && typeof module === 'object' && 'default' in module
      ? module.default
      : undefined;
  if (!owed.guard(exported)) {
    throw new InternalError(
      `Loading plugin "${identity}" failed: the module exports no default ${owed.noun} function.`,
      undefined,
    );
  }
  return exported;
}

/** One plugin's declared middleware: what wakes it, and the loader that fetches its module. */
interface BuiltMiddleware {
  activate: 'always' | readonly string[];
  load: () => unknown;
}

/** One plugin's middleware, or `undefined` for a plugin that declares none. */
function readMiddleware(
  identity: string,
  declared: { activate?: unknown; load?: unknown } | undefined,
  names: ReadonlySet<string>,
): BuiltMiddleware | undefined {
  if (declared === undefined) {
    return undefined;
  }
  if (!isPlainObject(declared)) {
    throw new DeclarationError(
      `${pluginSentence(identity)} declares middleware that is not an object. Supply { activate, load }.`,
    );
  }
  const activate = readActivation(identity, declared.activate, names);
  const { load } = declared;
  if (!isLoader(load)) {
    throw new DeclarationError(
      `${pluginSentence(identity)} declares middleware with no load function. Supply load: () => import('./middleware.js').`,
    );
  }
  return { activate, load };
}

/**
 * The Commands one plugin attaches to the root, each checked by the attach the root applies, as a
 * finished Command, against the plugin's own earlier Commands, and against the nesting cap. The
 * Application attaches them again when it is constructed, against every other root child.
 */
function readCommands(identity: string, declared: unknown): readonly AttachedChild[] {
  if (declared === undefined) {
    return [];
  }
  if (!Array.isArray(declared)) {
    throw new DeclarationError(
      `${pluginSentence(identity)} declares commands that are not an array. Supply a list of Command values.`,
    );
  }
  const list: readonly unknown[] = declared;
  const commands: AttachedChild[] = [];
  // A for...of walk reads a hole as undefined, which the entry rule rejects, where map would skip it.
  for (const value of list) {
    const node = commandNode(value);
    if (!node) {
      throw new DeclarationError(
        `${pluginSentence(identity)} holds a value that is not a Command. Supply the value returned by new Command(name).`,
      );
    }
    commands.push(
      attach({ argument: undefined, children: commands, hasAction: false, name: null }, node),
    );
  }
  return commands;
}

/**
 * One plugin's claim on the signals slot, drawn from the closed set core installs listeners for.
 * An empty list claims nothing, so it leaves the slot free for another plugin.
 * Each signal is claimed once, because core installs one listener per entry and a second listener
 * on one signal would take the force path on the first signal the run receives.
 */
function readSignals(identity: string, declared: unknown): readonly ProcessSignal[] {
  if (declared === undefined) {
    return [];
  }
  if (!Array.isArray(declared)) {
    throw new DeclarationError(
      `${pluginSentence(identity)} declares signals that are not an array. Supply a list of signal names.`,
    );
  }
  const list: readonly unknown[] = declared;
  const claimed = new Set<ProcessSignal>();
  for (const value of list) {
    if (!isProcessSignal(value)) {
      throw new DeclarationError(
        `${pluginSentence(identity)} claims signal "${String(value)}". Claim SIGINT or SIGTERM.`,
      );
    }
    if (claimed.has(value)) {
      throw new DeclarationError(
        `${pluginSentence(identity)} claims signal "${value}" twice. Claim each signal once.`,
      );
    }
    claimed.add(value);
  }
  return [...claimed];
}

/**
 * A lifecycle hook is a function core calls at one named point, so being callable is the whole
 * claim this check makes; every rule the calls it makes carry belongs to the build that calls it.
 */
function isHook(value: unknown): value is CommandAttachHook {
  return typeof value === 'function';
}

/** One plugin's `onCommandAttach` hook, or `undefined` for a plugin that declares none. */
function readHook(identity: string, declared: unknown): CommandAttachHook | undefined {
  if (declared === undefined) {
    return undefined;
  }
  if (!isHook(declared)) {
    throw new DeclarationError(
      `${pluginSentence(identity)} declares onCommandAttach that is not a function. Supply a function of the Command.`,
    );
  }
  return declared;
}

/**
 * One plugin's configuration source: the identity of the binding that marks an option as
 * configuration-bound, and the loader that fetches the resolver's module.
 */
interface BuiltSource {
  binding: string;
  load: () => unknown;
}

/**
 * The configuration source one plugin declares, or `undefined` for a plugin that declares none.
 * The binding is one of the plugin's own option-target extensions, so core knows which options to
 * ask about without knowing what the binding means. The plugin's own options resolve before the
 * source loads, so none of them may carry its binding.
 */
function readSource(
  identity: string,
  declaration: DeclaredPlugin,
  own: { build: PluginRegisters; inputs: readonly OptionInput[] },
): BuiltSource | undefined {
  const declared = declaration.source;
  if (declared === undefined) {
    return undefined;
  }
  const sentence = pluginSentence(identity);
  if (!isPlainObject(declared)) {
    throw new DeclarationError(
      `${sentence} declares a source that is not an object. Supply { binding, load }.`,
    );
  }
  const { binding, load } = declared;
  const listed = (declaration.extensions ?? []).some((descriptor) => descriptor === binding);
  if (!listed || !isDescriptor(binding)) {
    throw new DeclarationError(
      `${sentence} declares a source binding that is not one of its extensions. Supply a descriptor the plugin lists under extensions.`,
    );
  }
  if (binding.target !== 'option') {
    throw new DeclarationError(
      `${sentence} declares source binding "${binding.identity}", which applies to ${appliesTo(binding.target)}. Supply an extension that applies to options.`,
    );
  }
  if (!isLoader(load)) {
    throw new DeclarationError(
      `${sentence} declares a source with no load function. Supply load: () => import('./source.js').`,
    );
  }
  const carrier = own.inputs.find((input) =>
    Object.hasOwn(own.build.records.get(input) ?? {}, binding.identity),
  );
  if (carrier) {
    throw new DeclarationError(
      `${sentence} option "${carrier.name}" carries its own source binding. Remove the value; the source's own options resolve before it loads.`,
    );
  }
  return { binding: binding.identity, load };
}

/** One plugin's declarations, read once at its `plugin()` call. */
interface BuiltPlugin {
  theme: Palette | undefined;
  /** The hook core calls once per Command at graph build, or nothing where none is declared. */
  onCommandAttach: CommandAttachHook | undefined;
  /** The plugin's own `views` slot, read once the validated theme is in place. */
  views: unknown;
  identity: string;
  inputs: readonly OptionInput[];
  middleware: BuiltMiddleware | undefined;
  signals: readonly ProcessSignal[];
  source: BuiltSource | undefined;
  /** The Commands the plugin attaches to the root, in list order. */
  commands: readonly AttachedChild[];
  /** Every descriptor the plugin defines or its options' values name, by identity. */
  descriptors: ReadonlyMap<string, AnyExtension>;
  /** The extension record each of the plugin's own options carries. */
  records: InputRecords;
}

/** The registers one `plugin()` call fills while it reads the definition's contributions. */
interface PluginRegisters {
  descriptors: DescriptorRegistry;
  records: Map<InputDeclaration, Readonly<Record<string, unknown>>>;
}

/** A plugin's own list names the extensions it defines, before any declaration carries one. */
function defineExtensions(
  identity: string,
  declaration: DeclaredPlugin,
  build: PluginRegisters,
): void {
  const { extensions } = declaration;
  if (extensions !== undefined && !Array.isArray(extensions)) {
    throw new DeclarationError(
      `${pluginSentence(identity)} declares extensions that are not an array. Supply a list of extension descriptors.`,
    );
  }
  for (const descriptor of extensions ?? []) {
    if (!isDescriptor(descriptor)) {
      throw new DeclarationError(
        `${pluginSentence(identity)} holds a value that is not an extension. Supply the value returned by extension(identity, config).`,
      );
    }
    registerDescriptor(build.descriptors, descriptor);
  }
}

/**
 * Every rule one definition carries on its own, in the order the definition's slots are read. The
 * plugin's own extensions register before any declaration carries a value, so a duplicated package
 * copy is reported from the list that defines it. The views list is read against core's view
 * identities, and the Application reads it again against every other contributor's.
 */
function readPlugin(identity: unknown, definition: DeclaredPlugin): BuiltPlugin {
  const named = readIdentity(identity);
  const declaration = definitionOf(named, definition);
  const theme = declaration.theme === undefined ? undefined : buildTheme(declaration.theme, named);
  const build: PluginRegisters = { descriptors: new Map(), records: new Map() };
  defineExtensions(named, declaration, build);
  const inputs = readOptions(named, declaration.options, build);
  const names = new Set(inputs.map((input) => input.name));
  const signals = readSignals(named, declaration.signals);
  const source = readSource(named, declaration, { build, inputs });
  const commands = readCommands(named, declaration.commands);
  const middleware = readMiddleware(named, declaration.middleware, names);
  const onCommandAttach = readHook(named, declaration.onCommandAttach);
  buildViews(
    { declares: true, sentence: pluginSentence(named) },
    declaration.views,
    viewIdentities(coreViews),
  );
  return {
    commands,
    descriptors: build.descriptors,
    identity: named,
    inputs,
    middleware,
    onCommandAttach,
    records: build.records,
    signals,
    source,
    theme,
    views: declaration.views,
  };
}

/** The signals the one slot owner claimed, or none when no installed plugin claims the slot. */
function ownedSignals(plugins: readonly BuiltPlugin[]): readonly ProcessSignal[] {
  return plugins.find((entry) => entry.signals.length > 0)?.signals ?? [];
}

/** The value shape a plugin option takes, which is what `OptionValue` gives its declaration. */
type PluginValues = Record<string, string | string[] | boolean | undefined>;

/** A collected value, or the declared array default, as this run's own copy. */
function collectedValue(collected: readonly string[] | undefined, declared: unknown): string[] {
  if (collected) {
    return [...collected];
  }
  return Array.isArray(declared) ? [...declared] : [];
}

/**
 * One plugin's own option values for one run: what argv or an input source supplied, or the
 * declared default, filled without validation. A collected value and an array default are copied,
 * so a plugin that writes to what it received changes neither the declaration nor the next run.
 */
function pluginValues(inputs: readonly OptionInput[], values: OptionValues): PluginValues {
  const resolved: PluginValues = {};
  for (const { config, name } of inputs) {
    const declared: unknown = config.default;
    if (config.type === 'boolean') {
      resolved[name] = booleanValue(values, name, config);
    } else if (config.multiple === true) {
      resolved[name] = collectedValue(values.lists.get(name), declared);
    } else {
      // Build already proved that a string option without a validator declares a string default.
      resolved[name] =
        values.strings.get(name) ?? (typeof declared === 'string' ? declared : undefined);
    }
  }
  return resolved;
}

type ThemeOf<Contributor> = [Contributor] extends [never]
  ? {}
  : Contributor extends Plugin<PluginOptions, infer Theme>
    ? Theme
    : {};

export type {
  ThemeOf,
  BuiltPlugin,
  BuiltSource,
  PluginValues,
  SourceAnswer,
  SourceContext,
  SourceResolver,
  Middleware,
  OptionsOf,
  Plugin,
  PluginDefinition,
  PluginOptions,
  PluginOptionValues,
};
export { installPlugins, loadDefault, ownedSignals, plugin, pluginSentence, pluginValues };
