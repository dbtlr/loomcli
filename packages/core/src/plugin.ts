import { claimVariables } from './bindings.js';
import type { MiddlewareContext } from './chain.js';
import { attach, childNode, commandCode, commandNode } from './command.js';
import type { AttachedChild, Command } from './command.js';
import { elided, quoteString, spelled } from './diagnostic-text.js';
import type { Finding } from './diagnostic-text.js';
import { readEncodings } from './encoders.js';
import type { FailureEncoder, FailureEncoding } from './encoders.js';
import { DeclarationError, InternalError, midSentence, quoted, reasonOf } from './errors.js';
import { buildExtensions, registerDescriptor } from './extension.js';
import type { AdmittedDescriptor, AnyExtension, DescriptorRegistry } from './extension.js';
import { partFinding, pluginOptionSite, slotSite } from './facts.js';
import type { FactSite } from './facts.js';
import { boundOptions, pluginSites } from './globals.js';
import type { InputRecords } from './globals.js';
import type { FailureHook } from './hints.js';
import type { CommandGraph, OptionNode } from './inspect.js';
import { coreViews } from './lanes.js';
import type { Log, LogHook } from './log.js';
import { compileOptions } from './options.js';
import type { OptionValues } from './options.js';
import {
  failureEncoderTaken,
  foreignValue,
  foreignValueCorrection,
  pluginInstalledTwice,
  slotTaken,
} from './plugin-rules.js';
import type { EnvironmentHook } from './prepare-environment.js';
import { pluginLoaderFailed } from './rules.js';
import type { ContextualStyle, ThemeConstraint, ThemeMapping } from './style.js';
import { buildTheme } from './theme.js';
import type { BuiltTheme } from './theme.js';
import { readTranslations } from './translators.js';
import type { Translation, TranslationContributor } from './translators.js';
import type {
  CommandAttachHook,
  GlobalOptionConfig,
  GraphBuiltHook,
  Host,
  OptionValue,
  Out,
} from './types.js';
import type { InputDeclaration, OptionInput } from './validation.js';
import { buildViews, viewIdentities } from './view.js';
import type { ViewContribution, ViewSubject } from './view.js';

/**
 * The declaration record a plugin contributes its global options under, keyed by option name. Each
 * entry takes the configuration `globalOption()` takes, so the config type publishes no presence
 * rule.
 */
type PluginOptions = Readonly<Record<string, GlobalOptionConfig>>;

/**
 * The values one plugin's options take, read through the same `OptionValue` an action's options
 * are, so a validated option reads as its validator's output.
 */
type PluginOptionValues<Options extends PluginOptions> = {
  readonly [Name in keyof Options & string]: OptionValue<Options[Name]>;
};

/**
 * The spelling that supplied each of one plugin's own options given as a token, such as `-h`,
 * `--help`, or `--no-total`. An option filled by an input source, defaulted, or not supplied has
 * no entry.
 */
type PluginOptionSpellings<Options extends PluginOptions> = Readonly<
  Partial<Record<keyof Options & string, string>>
>;

/** Phantom key. It carries a plugin's declared options in a read position and holds no value. */
declare const pluginOptions: unique symbol;
declare const pluginTheme: unique symbol;

/**
 * One plugin's declarations as `plugin()` receives them, with the generic parts erased: the
 * middleware activation and the loaders read as plain names and functions, the theme as any
 * mapping, and the Commands as any Command values.
 */
interface DeclaredPlugin {
  theme?: ThemeMapping | undefined;
  options?: PluginOptions | undefined;
  middleware?: { activate: 'always' | readonly string[]; load: () => unknown } | undefined;
  onCommandAttach?: CommandAttachHook | undefined;
  onGraphBuilt?: GraphBuiltHook | undefined;
  onFailure?: FailureHook | undefined;
  onLog?: LogHook | undefined;
  onEnvironment?: EnvironmentHook | undefined;
  extensions?: readonly AnyExtension[] | undefined;
  views?: readonly ViewContribution[] | undefined;
  translators?: readonly Translation[] | undefined;
  failureEncoders?: readonly FailureEncoding[] | undefined;
  source?: { binding: AnyExtension; load: () => unknown } | undefined;
  commands?: readonly unknown[] | undefined;
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

/**
 * The option values an installed plugin tuple contributes to every action's options, each plugin's
 * read through `PluginOptionValues`. The Application computes it once from the constructor's
 * `plugins`. A plugin typed as the wide `Plugin` states no option names, and a list widened to
 * `Plugin[]` states no plugins, so neither names an option.
 */
type InstalledOptionValues<Plugins extends readonly Plugin[]> = Plugins extends readonly [
  infer First extends Plugin,
  ...infer Rest extends readonly Plugin[],
]
  ? (string extends keyof OptionsOf<First> ? {} : PluginOptionValues<OptionsOf<First>>) &
      InstalledOptionValues<Rest>
  : {};

/** A middleware reads its own plugin's options and either takes over or continues the chain. */
type Middleware<Contributor extends Plugin | ((...args: never[]) => Plugin)> = (
  context: MiddlewareContext<OptionsOf<Contributor>>,
) => Promise<void> | void;

/**
 * What a configuration source receives: the host, its own plugin's option values, resolved from
 * argv, the environment, and their defaults, the `OptionNode` of every option core asks about, and
 * the ordinary channels a middleware and an action already read. Each request is a node inside
 * `graph`, the graph `inspect()` returns for the run. `out` is the channel a middleware receives,
 * and `style` the contextual style an action receives, so a source warns and escapes as they do.
 * `invokedBy` reads `'name'` in a run `invoke()` started, where a problem names an option by its
 * declared name, as core's own problems do there.
 */
interface SourceContext<Options extends PluginOptions = PluginOptions> {
  readonly host: Host;
  readonly options: PluginOptionValues<Options>;
  readonly requests: readonly OptionNode[];
  readonly graph: CommandGraph;
  readonly out: Out;
  readonly style: ContextualStyle;
  readonly invokedBy: 'argv' | 'name';
  /** Records a log event under the plugin's identity, as a middleware's `log` does. */
  readonly log: Log;
}

/**
 * One answer: a value of the option's raw type, a string, a Boolean, a whole number of 0 or more
 * for a counted option, or a list of strings for a multiple option, and the one-line label core
 * prints in a diagnostic about the value.
 */
interface SourceAnswer {
  readonly value: string | boolean | number | readonly string[];
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
 * creating and installing the value runs none of its code: `onCommandAttach` runs at graph build,
 * `onGraphBuilt` runs once the graph is built and frozen, `onFailure` runs when `run()` renders a
 * failure, `onLog` runs when a run logs an event, `onEnvironment` prepares additions before input validation, the middleware runs inside an invocation, the configuration source runs in the
 * input-source stage when an unfilled option carries its binding, and a translator runs when a
 * foreign throw its key matches leaves the application's work.
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
  onGraphBuilt?: GraphBuiltHook;
  onFailure?: FailureHook;
  onLog?: LogHook;
  onEnvironment?: EnvironmentHook;
  extensions?: readonly AnyExtension[];
  views?: readonly ViewContribution[];
  translators?: readonly Translation[];
  /** The encoders a failed `run()` writes its failure through, one per media type. */
  failureEncoders?: readonly FailureEncoding[];
  source?: {
    binding: AnyExtension & { readonly target: 'option' };
    load: () => Promise<{ default: SourceResolver<Plugin<Options>> }>;
  };
  commands?: readonly Command<unknown, unknown>[];
}

/**
 * One plugin: an identity and the contributions it carries. Creating and installing the value runs
 * none of its code: `onCommandAttach` and `onGraphBuilt` run at graph build, `onFailure` runs when
 * `run()` renders a failure, `onLog` runs when a run logs an event, `onEnvironment` prepares additions before input validation, and the middleware runs inside an invocation, so an installed plugin
 * an invocation never reaches costs that invocation its hooks alone. The definition is read once,
 * after the identity, and every rule that one definition carries on its own throws here, before
 * the value exists.
 */
function plugin<Options extends PluginOptions = {}, const Theme extends ThemeMapping = {}>(
  identity: string,
  definition: PluginDefinition<Options, Theme>,
): Plugin<NoInfer<Options>, NoInfer<Theme>> {
  return new PluginDeclaration<Options, Theme>(readPlugin(identity, definition));
}

/** How every plugin diagnostic names one plugin at the start of a sentence. */
function pluginSentence(identity: string): string {
  return `Plugin ${quoted(identity)}`;
}

/** Where one slot of a plugin's definition sits, rebuilt as `plugin(identity, { slot })`. */
function pluginSlot(identity: string, slot: string, value: unknown): FactSite {
  return slotSite(
    { call: 'plugin', named: identity, subject: pluginSentence(identity) },
    slot,
    value,
  );
}

/** The subject a plugin's `views` list reports under, and the call that declared it. */
function pluginViews(identity: string): ViewSubject {
  return {
    owner: { call: 'plugin', named: identity },
    sentence: pluginSentence(identity),
  };
}

/** The declarations behind one installed value, or `undefined` for a value this copy did not make. */
function nodeOf(value: object): BuiltPlugin | undefined {
  return nodes.get(value);
}

/** One `plugins` entry as a finding prints it: a plugin as its `plugin()` call, elided. */
function entryCode(value: object): unknown {
  const node = nodeOf(value);
  return node ? spelled(`plugin(${quoteString(node.identity)}, ${elided})`) : value;
}

/** What the installed list resolves to: the plugins in order, and every descriptor they define. */
interface InstalledPlugins {
  descriptors: DescriptorRegistry;
  plugins: readonly BuiltPlugin[];
}

/** The slots one plugin at most may claim. */
type Slot = 'source' | 'theme';

/** How a second claim on one slot reads: its clause, the note on the owner's entry, and the fix. */
const slotWords: Readonly<
  Record<Slot, { clause: (owner: string) => string; held: string; correction: string }>
> = {
  source: {
    clause: (owner) =>
      `declares a configuration source, which plugin ${quoted(owner)} already declares.`,
    correction: 'Install one source.',
    held: 'declares the configuration source',
  },
  theme: {
    clause: (owner) => `claims the theme slot, which plugin ${quoted(owner)} already holds.`,
    correction: 'Install one owner.',
    held: 'holds the theme slot',
  },
};

/** A second claim on one slot, which marks the owner's entry and the claimant's in `plugins`. */
function slotFault(
  site: FactSite,
  slot: Slot,
  claim: { installed: readonly BuiltPlugin[]; owner: number; claimant: number },
): DeclarationError {
  const { claimant, installed, owner } = claim;
  const words = slotWords[slot];
  return new DeclarationError(slotTaken, {
    correction: words.correction,
    findings: [
      partFinding(site, [owner], words.held),
      partFinding(site, [claimant], 'claims it again'),
    ],
    sentence: `${pluginSentence(installed[claimant]?.identity ?? '')} ${words.clause(installed[owner]?.identity ?? '')}`,
  });
}

/**
 * The installed list in composition order, with every rule that reads two plugins together: an
 * identity installed twice, a second claim on the theme slot or the configuration source, and two
 * distinct descriptors under one identity. Each plugin's own rules already ran at its `plugin()`
 * call. A plugin another installed copy of `@loomcli/core` built misses this copy's registry.
 */
function installPlugins(application: string, plugins: readonly Plugin[]): InstalledPlugins {
  const site = slotSite(
    { call: 'new Application', named: application, subject: 'The Application' },
    'plugins',
    Array.from(plugins, entryCode),
  );
  const installed = plugins.map((value, index) => {
    const node = nodeOf(value);
    if (!node) {
      throw new DeclarationError(foreignValue, {
        correction: foreignValueCorrection,
        findings: [partFinding(site, [index])],
        sentence: 'The Application holds a plugin another installed copy of @loomcli/core built.',
      });
    }
    return node;
  });
  const positions = new Map<string, number>();
  const descriptors: DescriptorRegistry = new Map();
  // Each slot has one owner, so the first plugin to claim it names the second claimant's diagnostic.
  const owners = new Map<Slot, number>();
  // Each media type has one encoder, so the first plugin to register it names the second's diagnostic.
  const encoders = new Map<string, { identity: string; index: number }>();
  const claim = (slot: Slot, index: number) => {
    const owner = owners.get(slot);
    if (owner !== undefined) {
      throw slotFault(site, slot, { claimant: index, installed, owner });
    }
    owners.set(slot, index);
  };
  for (const [index, entry] of installed.entries()) {
    const { identity } = entry;
    const first = positions.get(identity);
    if (first !== undefined) {
      throw new DeclarationError(pluginInstalledTwice, {
        correction: 'Install each plugin once.',
        findings: [
          partFinding(site, [first], 'the first installation'),
          partFinding(site, [index], 'the second installation'),
        ],
        sentence: `The Application installs plugin ${quoted(identity)} twice.`,
      });
    }
    positions.set(identity, index);
    if (entry.theme !== undefined) {
      claim('theme', index);
    }
    for (const [key, descriptor] of entry.descriptors) {
      registerDescriptor(descriptors, descriptor, {
        identity: key,
        place: partFinding(site, [index]),
      });
    }
    if (entry.source) {
      claim('source', index);
    }
    for (const mediaType of entry.failureEncoders.keys()) {
      const registered = encoders.get(mediaType);
      if (registered !== undefined) {
        throw new DeclarationError(failureEncoderTaken, {
          correction: 'Install one of them.',
          findings: [
            partFinding(site, [registered.index], 'the first encoder'),
            partFinding(site, [index], 'the second encoder'),
          ],
          sentence: `${pluginSentence(identity)} registers a failure encoder for ${quoted(mediaType)}, which plugin ${quoted(registered.identity)} already registers.`,
        });
      }
      encoders.set(mediaType, { identity, index });
    }
  }
  return { descriptors, plugins: installed };
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
  const inputs: OptionInput[] = [];
  // A finding prints each option's config once it is read, and each later one elided.
  const shown: Record<string, unknown> = Object.fromEntries(
    Object.keys(declared ?? {}).map((name) => [name, spelled(elided)]),
  );
  for (const [name, entry] of Object.entries(declared ?? {})) {
    const sentence = `${pluginSentence(identity)} option ${quoted(name)}`;
    // A computed key defines its own property even for `__proto__`, where assignment would not.
    const siteOf = (value: unknown) =>
      pluginOptionSite({ identity, options: { ...shown, [name]: value } }, name, sentence);
    const config = { ...entry };
    // Defining the key keeps its place, and holds even for a key of `__proto__`.
    Object.defineProperty(shown, name, {
      configurable: true,
      enumerable: true,
      value: config,
      writable: true,
    });
    const site = siteOf(config);
    const input: OptionInput = { config, kind: 'option', name };
    build.records.set(
      input,
      buildExtensions({
        declared: config.extensions,
        descriptors: build.descriptors,
        site: { ...site, at: `${site.at}.extensions` },
        subject: {
          phrase: `on ${midSentence(sentence)}`,
          sentence,
        },
      }),
    );
    inputs.push(input);
  }
  // Two options of one plugin meet in the globals table every Command's table holds.
  // They therefore share its rules.
  const siteOf = pluginSites(identity, inputs);
  compileOptions(inputs, { siteOf, subject: `plugin ${quoted(identity)}` });
  claimVariables(
    boundOptions(inputs, (input) => ({
      phrase: `plugin ${quoted(identity)} option ${quoted(input.name)}`,
      site: siteOf(input),
    })),
  );
  return inputs;
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
    throw new InternalError(pluginLoaderFailed, {
      cause: error,
      correction: loaderCorrection,
      sentence: `Loading plugin ${quoted(identity)} failed: ${reasonOf(error)}`,
    });
  }
  const exported: unknown =
    module !== null && typeof module === 'object' && 'default' in module
      ? module.default
      : undefined;
  if (!owed.guard(exported)) {
    throw new InternalError(pluginLoaderFailed, {
      cause: undefined,
      correction: loaderCorrection,
      sentence: `Loading plugin ${quoted(identity)} failed: the module exports no default ${owed.noun} function.`,
    });
  }
  return exported;
}

/** The fix every plugin loader fault shares. */
const loaderCorrection =
  "Make load() resolve to a module whose default export is the plugin's function, such as () => import('./middleware.js').";

/** One plugin's declared middleware: what wakes it, and the loader that fetches its module. */
interface BuiltMiddleware {
  activate: 'always' | readonly string[];
  load: () => unknown;
}

/**
 * The Commands one plugin attaches to the root, each checked by the attach the root applies, as a
 * finished Command and against the plugin's own earlier Commands. The Application attaches them
 * again when it is constructed, against every other root child.
 */
function readCommands(identity: string, list: readonly unknown[]): readonly AttachedChild[] {
  const commands: AttachedChild[] = [];
  // Each entry prints as the Command it is, so a finding rebuilds the list the plugin declared.
  const entries = list.map((value) => {
    const node = commandNode(value);
    return node ? commandCode(node.name) : value;
  });
  for (const [index, value] of list.entries()) {
    const placement: Finding = {
      arguments: [identity, { commands: entries }],
      call: 'plugin',
      mark: `1.commands.${String(index)}`,
    };
    const parent = { children: commands, name: null, path: [] };
    commands.push(attach(parent, childNode(value), placement));
  }
  return commands;
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
 * The configuration source one plugin declares, or `undefined` for a plugin that declares none. The
 * binding is an option-target extension, so core knows which options to ask about without knowing
 * what the binding means. Core admits the binding's descriptor itself, so a binding the plugin does
 * not also list under `extensions` works the same.
 */
function readSource(identity: string, declaration: DeclaredPlugin, build: PluginRegisters) {
  const declared = declaration.source;
  if (declared === undefined) {
    return undefined;
  }
  const { binding, load } = declared;
  const site = pluginSlot(identity, 'source', declared);
  registerDescriptor(build.descriptors, binding, {
    place: partFinding(site, ['binding']),
  });
  return { binding: binding.identity, load };
}

/** One plugin's declarations, read once at its `plugin()` call. */
interface BuiltPlugin {
  theme: BuiltTheme | undefined;
  /** The hook core calls once per Command at graph build, or nothing where none is declared. */
  onCommandAttach: CommandAttachHook | undefined;
  /** The hook core calls once per graph build with the frozen graph, or nothing. */
  onGraphBuilt: GraphBuiltHook | undefined;
  /** The hook core calls for each failure `run()` renders after graph build, or nothing. */
  onFailure: FailureHook | undefined;
  /** The hook core calls for each log event of a run, or nothing. */
  onLog: LogHook | undefined;
  /** Prepares additions once per captured environment, before any declared value validates. */
  onEnvironment: EnvironmentHook | undefined;
  /** The plugin's own `views` list, which the Application reads again. */
  views: readonly ViewContribution[] | undefined;
  /** The translations the plugin registers, which resolve after the application's. */
  translators: TranslationContributor;
  /** The failure encoders the plugin registers, by media type. */
  failureEncoders: ReadonlyMap<string, FailureEncoder>;
  identity: string;
  inputs: readonly OptionInput[];
  middleware: BuiltMiddleware | undefined;
  source: BuiltSource | undefined;
  /** The Commands the plugin attaches to the root, in list order. */
  commands: readonly AttachedChild[];
  /** Every descriptor the plugin defines or its options' values name, by identity. */
  descriptors: ReadonlyMap<string, AdmittedDescriptor>;
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
  const { extensions = [] } = declaration;
  const site = pluginSlot(identity, 'extensions', extensions);
  for (const [index, descriptor] of extensions.entries()) {
    registerDescriptor(build.descriptors, descriptor, {
      place: partFinding(site, [index]),
    });
  }
}

/**
 * Every rule one definition carries on its own, in the order the definition's slots are read. The
 * plugin's own extensions register before any declaration carries a value, so a duplicated package
 * copy is reported from the list that defines it. The views list is read against core's view
 * identities, and the Application reads it again against every other contributor's.
 */
function readPlugin(identity: string, declaration: DeclaredPlugin): BuiltPlugin {
  const theme = declaration.theme === undefined ? undefined : buildTheme(declaration.theme);
  const build: PluginRegisters = { descriptors: new Map(), records: new Map() };
  defineExtensions(identity, declaration, build);
  const inputs = readOptions(identity, declaration.options, build);
  const source = readSource(identity, declaration, build);
  const commands = readCommands(identity, declaration.commands ?? []);
  buildViews(pluginViews(identity), declaration.views, viewIdentities(coreViews));
  const translators = readTranslations(
    pluginSlot(identity, 'translators', declaration.translators),
    declaration.translators,
  );
  const failureEncoders = readEncodings(
    pluginSlot(identity, 'failureEncoders', declaration.failureEncoders),
    declaration.failureEncoders,
  );
  const { middleware } = declaration;
  return {
    commands,
    descriptors: build.descriptors,
    failureEncoders,
    identity,
    inputs,
    middleware: middleware && { activate: middleware.activate, load: middleware.load },
    onCommandAttach: declaration.onCommandAttach,
    onEnvironment: declaration.onEnvironment,
    onFailure: declaration.onFailure,
    onGraphBuilt: declaration.onGraphBuilt,
    onLog: declaration.onLog,
    records: build.records,
    source,
    theme,
    translators,
    views: declaration.views,
  };
}

/** One plugin's own spellings for one run, frozen, so no plugin writes what another reads. */
function pluginSpellings(
  inputs: readonly OptionInput[],
  values: OptionValues,
): Readonly<Record<string, string>> {
  // Entries become own keys even for a name such as `__proto__`, which assignment would not.
  const supplied = inputs.flatMap(({ name }): [string, string][] => {
    const spelling = values.spellings.get(name);
    return spelling === undefined ? [] : [[name, spelling]];
  });
  return Object.freeze(Object.fromEntries(supplied));
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
  InstalledOptionValues,
  SourceAnswer,
  SourceContext,
  SourceResolver,
  Middleware,
  OptionsOf,
  Plugin,
  PluginDefinition,
  PluginOptions,
  PluginOptionSpellings,
  PluginOptionValues,
};
export { installPlugins, loadDefault, plugin, pluginSentence, pluginSpellings, pluginViews };
