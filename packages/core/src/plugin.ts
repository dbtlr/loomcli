import { checkEnvBinding, claimVariables } from './bindings.js';
import type { MiddlewareContext } from './chain.js';
import { notACommand } from './command-rules.js';
import { attach, commandCode, commandNode } from './command.js';
import type { AttachedChild, Command } from './command.js';
import { elided, quoteString, spelled } from './diagnostic-text.js';
import type { Finding } from './diagnostic-text.js';
import { DeclarationError, InternalError, quoted, reasonOf } from './errors.js';
import { appliesTo, buildExtensions, isDescriptor, registerDescriptor } from './extension.js';
import type { AnyExtension, DescriptorRegistry } from './extension.js';
import {
  checkDeprecated,
  checkDescription,
  checkHidden,
  factFault,
  partFinding,
  pluginOptionSite,
  slotSite,
} from './facts.js';
import type { FactSite } from './facts.js';
import { boundOptions, pluginSites } from './globals.js';
import type { InputRecords } from './globals.js';
import type { FailureHook } from './hints.js';
import type { CommandGraph, OptionNode } from './inspect.js';
import { coreViews } from './lanes.js';
import { booleanValue, compileOptions } from './options.js';
import type { OptionValues } from './options.js';
import { isPlainObject } from './plain.js';
import {
  foreignValue,
  middlewareActivation,
  notAFunction,
  notAList,
  notAnObject,
  pluginIdentity,
  pluginInstalledTwice,
  pluginOptionRule,
  signalClaimedTwice,
  slotTaken,
  sourceBinding,
  sourceBoundOwnOption,
  unknownSignal,
} from './plugin-rules.js';
import { pluginLoaderFailed } from './rules.js';
import { isProcessSignal } from './signals.js';
import type { ProcessSignal } from './signals.js';
import type { Palette } from './style-state.js';
import type { ContextualStyle, ThemeConstraint, ThemeMapping } from './style.js';
import { buildTheme } from './theme.js';
import { readTranslations } from './translators.js';
import type { Translation, TranslationContributor } from './translators.js';
import type { CommandAttachHook, Host, OptionValue, Out, PluginOptionConfig } from './types.js';
import { captureConfig, checkDeclarations } from './validation.js';
import type { InputDeclaration, OptionInput } from './validation.js';
import { buildViews, viewIdentities } from './view.js';
import type { ViewContribution, ViewSubject } from './view.js';

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
 * One plugin's declarations as `plugin()` receives them, with the generic parts erased. The call
 * reads every one of them defensively, because a JavaScript author reaches the same slots, so the
 * erased shape is what the rules below read and no declaration is claimed to be well formed here.
 */
interface DeclaredPlugin {
  theme?: unknown;
  options?: PluginOptions;
  middleware?: { activate?: unknown; load?: unknown };
  onCommandAttach?: unknown;
  onFailure?: unknown;
  extensions?: readonly AnyExtension[];
  views?: unknown;
  translators?: unknown;
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
 * argv, the environment, and their defaults, the `OptionNode` of every option core asks about, and
 * the ordinary channels a middleware and an action already read. Each request is a node inside
 * `graph`, the graph `inspect()` returns for the run. `out` is the channel a middleware receives,
 * and `style` the contextual style an action receives, so a source warns and escapes as they do.
 */
interface SourceContext<Options extends PluginOptions = PluginOptions> {
  readonly host: Host;
  readonly options: PluginOptionValues<Options>;
  readonly requests: readonly OptionNode[];
  readonly graph: CommandGraph;
  readonly out: Out;
  readonly style: ContextualStyle;
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
 * creating and installing the value runs none of its code: `onCommandAttach` runs at graph build,
 * `onFailure` runs when `run()` renders a failure, the middleware runs inside an invocation, the
 * configuration source runs in the input-source stage when an unfilled option carries its binding,
 * and a translator runs when a foreign throw its key matches leaves the application's work.
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
  onFailure?: FailureHook;
  extensions?: readonly AnyExtension[];
  views?: readonly ViewContribution[];
  translators?: readonly Translation[];
  signals?: readonly ('SIGINT' | 'SIGTERM')[];
  source?: {
    binding: AnyExtension & { readonly target: 'option' };
    load: () => Promise<{ default: SourceResolver<Plugin<Options>> }>;
  };
  commands?: readonly Command<unknown, unknown>[];
}

/**
 * One plugin: an identity and the contributions it carries. Creating and installing the value runs
 * none of its code: `onCommandAttach` runs at graph build, `onFailure` runs when `run()` renders a
 * failure, and the middleware runs inside an invocation, so an installed plugin an invocation never
 * reaches costs that invocation its hooks alone. Every rule
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
    declares: true,
    owner: { call: 'plugin', named: identity },
    sentence: pluginSentence(identity),
  };
}

/** The declarations behind one installed value, or `undefined` for a value `plugin()` did not make. */
function nodeOf(value: unknown): BuiltPlugin | undefined {
  return typeof value === 'object' && value !== null ? nodes.get(value) : undefined;
}

/** One `plugins` entry as a finding prints it: a plugin as its `plugin()` call, elided. */
function entryCode(value: unknown): unknown {
  const node = nodeOf(value);
  return node ? spelled(`plugin(${quoteString(node.identity)}, ${elided})`) : value;
}

/** The fix every plugin identity fault shares. */
const identityCorrection = 'Supply a nonempty string, such as the package name.';

/** The identity one plugin declares, which is a nonempty string. */
function readIdentity(identity: unknown): string {
  const findings = [{ arguments: [identity, spelled(elided)], call: 'plugin', mark: '0' }];
  if (typeof identity !== 'string') {
    throw new DeclarationError(pluginIdentity, {
      correction: identityCorrection,
      findings,
      sentence: 'A plugin declares an identity that is not a string.',
    });
  }
  if (identity === '') {
    throw new DeclarationError(pluginIdentity, {
      correction: identityCorrection,
      findings,
      sentence: 'A plugin declares an empty identity.',
    });
  }
  return identity;
}

/** The declarations one plugin value carries, which a JavaScript author reaches as any value. */
function definitionOf(identity: string, definition: DeclaredPlugin): DeclaredPlugin {
  if (!isPlainObject(definition)) {
    throw new DeclarationError(notAnObject, {
      correction: 'Supply { options, middleware, extensions, views }.',
      findings: [{ arguments: [identity, definition], call: 'plugin', mark: '1' }],
      sentence: `${pluginSentence(identity)} declares a definition that is not an object.`,
    });
  }
  return definition;
}

/** What the installed list resolves to: the plugins in order, and every descriptor they define. */
interface InstalledPlugins {
  descriptors: DescriptorRegistry;
  plugins: readonly BuiltPlugin[];
}

/** The slots one plugin at most may claim. */
type Slot = 'signals' | 'source' | 'theme';

/** How a second claim on one slot reads: its clause, the note on the owner's entry, and the fix. */
const slotWords: Readonly<
  Record<Slot, { clause: (owner: string) => string; held: string; correction: string }>
> = {
  signals: {
    clause: (owner) => `claims the signals slot, which plugin ${quoted(owner)} already holds.`,
    correction: 'Install one owner.',
    held: 'holds the signals slot',
  },
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
 * identity installed twice, a second claim on the theme slot, the signals slot, or the
 * configuration source, and two distinct descriptors under one identity. The slot is read
 * defensively, because a JavaScript author reaches it with any value. Each plugin's own rules
 * already ran at its `plugin()` call.
 */
function installPlugins(application: string, plugins: unknown): InstalledPlugins {
  const printed = Array.isArray(plugins) ? Array.from(plugins, entryCode) : plugins;
  const site = slotSite(
    { call: 'new Application', named: application, subject: 'The Application' },
    'plugins',
    printed,
  );
  if (!Array.isArray(plugins)) {
    throw new DeclarationError(notAList, {
      correction: 'Supply a list of plugin values.',
      findings: [partFinding(site, [])],
      sentence: 'The Application declares plugins that are not an array.',
    });
  }
  const list: readonly unknown[] = plugins;
  const installed = list.map((value, index) => {
    const node = nodeOf(value);
    if (!node) {
      throw new DeclarationError(foreignValue, {
        correction: 'Supply the value returned by plugin(identity, definition).',
        findings: [partFinding(site, [index])],
        sentence: 'The Application holds a value that is not a plugin.',
      });
    }
    return node;
  });
  const positions = new Map<string, number>();
  const descriptors: DescriptorRegistry = new Map();
  // Each slot has one owner, so the first plugin to claim it names the second claimant's diagnostic.
  const owners = new Map<Slot, number>();
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
    for (const descriptor of entry.descriptors.values()) {
      registerDescriptor(descriptors, descriptor, partFinding(site, [index]));
    }
    // An empty claim leaves the signals slot free.
    if (entry.signals.length > 0) {
      claim('signals', index);
    }
    if (entry.source) {
      claim('source', index);
    }
  }
  return { descriptors, plugins: installed };
}

/** The keys a plugin option may not declare, in the order its diagnostic names them. */
const forbidden = ['validate', 'validateOmitted', 'required'] as const;

/** The rules a plugin option answers before every rule an ordinary declaration carries. */
function checkPluginOption(site: FactSite, config: PluginOptionConfig): void {
  const sentence = site.subject;
  if (!isPlainObject(config)) {
    throw new DeclarationError(notAnObject, {
      correction: 'Supply { type, ... }.',
      findings: [partFinding(site, [])],
      sentence: `${sentence} is not an option declaration.`,
    });
  }
  const rejected = forbidden.find((key) => key in config);
  if (rejected !== undefined) {
    throw factFault(pluginOptionRule, site, {
      correction:
        'Remove it; a plugin option carries no validator or presence rule, and the middleware interprets the value.',
      fact: rejected,
      sentence: `${sentence} declares ${rejected}.`,
    });
  }
  checkDescription(site, config.description);
  checkHidden(site, config.hidden);
  checkDeprecated(site, config.deprecated);
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
    throw new DeclarationError(notAnObject, {
      correction: 'Supply a record of option declarations.',
      findings: [partFinding(pluginSlot(identity, 'options', declared), [])],
      sentence: `${pluginSentence(identity)} declares options that are not an object.`,
    });
  }
  const inputs: OptionInput[] = [];
  for (const [name, config] of Object.entries(declared ?? {})) {
    const sentence = `${pluginSentence(identity)} option ${quoted(name)}`;
    const site = pluginOptionSite({ identity, options: declared }, name, sentence);
    checkPluginOption(site, config);
    checkEnvBinding(site, config);
    const input: OptionInput = { config: captureConfig(config), kind: 'option', name };
    // The shared rules name the plugin and the option, so a fault reads with its contributor.
    checkDeclarations([{ input, site }], sentence);
    build.records.set(
      input,
      buildExtensions({
        declared: config.extensions,
        descriptors: build.descriptors,
        site: { ...site, at: `${site.at}.extensions` },
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
  const siteOf = pluginSites(identity, inputs);
  compileOptions(inputs, { siteOf, subject: `plugin ${quoted(identity)}` });
  claimVariables(
    boundOptions(inputs, (input) => ({
      phrase: `plugin ${quoted(identity)} option "${input.name}"`,
      site: siteOf(input),
    })),
  );
  return inputs;
}

/**
 * The activation a middleware declares, checked against the options its own plugin declares. `site`
 * holds the middleware object, and a fault marks its `activate` key, or the object itself when the
 * key is absent.
 */
function readActivation(
  site: FactSite,
  declared: { activate?: unknown },
  names: ReadonlySet<string>,
): 'always' | readonly string[] {
  const { activate } = declared;
  if (activate === 'always') {
    return 'always';
  }
  if (!Array.isArray(activate)) {
    throw new DeclarationError(middlewareActivation, {
      correction: "Supply activate: 'always' or a list of the plugin's own option names.",
      findings: [partFinding(site, 'activate' in declared ? ['activate'] : [])],
      sentence: `${site.subject} declares middleware with no activation.`,
    });
  }
  const list: readonly unknown[] = activate;
  if (list.length === 0) {
    throw new DeclarationError(middlewareActivation, {
      correction: "Name at least one of the plugin's options or use 'always'.",
      findings: [partFinding(site, ['activate'])],
      sentence: `${site.subject} declares middleware with an empty activation list.`,
    });
  }
  return list.map((name, index) => {
    if (typeof name !== 'string' || !names.has(name)) {
      throw new DeclarationError(middlewareActivation, {
        correction: "Name one of the plugin's own options.",
        findings: [partFinding(site, ['activate', index])],
        sentence: `${site.subject} activates middleware on option ${quoted(name)}, which it does not declare.`,
      });
    }
    return name;
  });
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

/** One plugin's middleware, or `undefined` for a plugin that declares none. */
function readMiddleware(
  identity: string,
  declared: { activate?: unknown; load?: unknown } | undefined,
  names: ReadonlySet<string>,
): BuiltMiddleware | undefined {
  if (declared === undefined) {
    return undefined;
  }
  const site = pluginSlot(identity, 'middleware', declared);
  if (!isPlainObject(declared)) {
    throw new DeclarationError(notAnObject, {
      correction: 'Supply { activate, load }.',
      findings: [partFinding(site, [])],
      sentence: `${pluginSentence(identity)} declares middleware that is not an object.`,
    });
  }
  const activate = readActivation(site, declared, names);
  const { load } = declared;
  if (!isLoader(load)) {
    throw new DeclarationError(notAFunction, {
      correction: "Supply load: () => import('./middleware.js').",
      findings: [partFinding(site, 'load' in declared ? ['load'] : [])],
      sentence: `${pluginSentence(identity)} declares middleware with no load function.`,
    });
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
    throw new DeclarationError(notAList, {
      correction: 'Supply a list of Command values.',
      findings: [partFinding(pluginSlot(identity, 'commands', declared), [])],
      sentence: `${pluginSentence(identity)} declares commands that are not an array.`,
    });
  }
  const list: readonly unknown[] = declared;
  const commands: AttachedChild[] = [];
  // Each entry prints as the Command it is, so a finding rebuilds the list the plugin declared.
  const entries = Array.from(list, (value) => {
    const node = commandNode(value);
    return node ? commandCode(node.name) : value;
  });
  // A for...of walk reads a hole as undefined, which the entry rule rejects, where map would skip it.
  for (const [index, value] of list.entries()) {
    const node = commandNode(value);
    const placement: Finding = {
      arguments: [identity, { commands: entries }],
      call: 'plugin',
      mark: `1.commands.${String(index)}`,
    };
    if (!node) {
      throw new DeclarationError(notACommand, {
        correction: 'Supply the value returned by new Command(name).',
        findings: [placement],
        sentence: `${pluginSentence(identity)} holds a value that is not a Command.`,
      });
    }
    const parent = {
      argument: undefined,
      children: commands,
      hasAction: false,
      name: null,
      path: [],
    };
    commands.push(attach(parent, node, placement));
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
  const site = pluginSlot(identity, 'signals', declared);
  if (!Array.isArray(declared)) {
    throw new DeclarationError(notAList, {
      correction: 'Supply a list of signal names.',
      findings: [partFinding(site, [])],
      sentence: `${pluginSentence(identity)} declares signals that are not an array.`,
    });
  }
  const list: readonly unknown[] = declared;
  // Each claimed signal's position, so a repeat marks both claims.
  const claimed = new Map<ProcessSignal, number>();
  for (const [index, value] of list.entries()) {
    if (!isProcessSignal(value)) {
      throw new DeclarationError(unknownSignal, {
        correction: 'Claim SIGINT or SIGTERM.',
        findings: [partFinding(site, [index])],
        sentence: `${pluginSentence(identity)} claims signal ${quoted(value)}.`,
      });
    }
    const first = claimed.get(value);
    if (first !== undefined) {
      throw new DeclarationError(signalClaimedTwice, {
        correction: 'Claim each signal once.',
        findings: [
          partFinding(site, [first], 'the first claim'),
          partFinding(site, [index], 'the second claim'),
        ],
        sentence: `${pluginSentence(identity)} claims signal ${quoted(value)} twice.`,
      });
    }
    claimed.set(value, index);
  }
  return [...claimed.keys()];
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
    throw new DeclarationError(notAFunction, {
      correction: 'Supply a function of the Command.',
      findings: [partFinding(pluginSlot(identity, 'onCommandAttach', declared), [])],
      sentence: `${pluginSentence(identity)} declares onCommandAttach that is not a function.`,
    });
  }
  return declared;
}

/** Being callable is the whole claim, as it is for `onCommandAttach`; `run()` checks what it returns. */
function isFailureHook(value: unknown): value is FailureHook {
  return typeof value === 'function';
}

/** One plugin's `onFailure` hook, or `undefined` for a plugin that declares none. */
function readFailureHook(identity: string, declared: unknown): FailureHook | undefined {
  if (declared === undefined) {
    return undefined;
  }
  if (!isFailureHook(declared)) {
    throw new DeclarationError(notAFunction, {
      correction: 'Supply a function of the failure and its context.',
      findings: [partFinding(pluginSlot(identity, 'onFailure', declared), [])],
      sentence: `${pluginSentence(identity)} declares onFailure that is not a function.`,
    });
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
  const site = pluginSlot(identity, 'source', declared);
  if (!isPlainObject(declared)) {
    throw new DeclarationError(notAnObject, {
      correction: 'Supply { binding, load }.',
      findings: [partFinding(site, [])],
      sentence: `${sentence} declares a source that is not an object.`,
    });
  }
  const { binding, load } = declared;
  // A fault about one key marks the key, or the source itself when the key is absent.
  const keyFinding = (key: string) => partFinding(site, key in declared ? [key] : []);
  const listed = (declaration.extensions ?? []).some((descriptor) => descriptor === binding);
  if (!listed || !isDescriptor(binding)) {
    throw new DeclarationError(sourceBinding, {
      correction: 'Supply a descriptor the plugin lists under extensions.',
      findings: [keyFinding('binding')],
      sentence: `${sentence} declares a source binding that is not one of its extensions.`,
    });
  }
  if (binding.target !== 'option') {
    throw new DeclarationError(sourceBinding, {
      correction: 'Supply an extension that applies to options.',
      findings: [keyFinding('binding')],
      sentence: `${sentence} declares source binding ${quoted(binding.identity)}, which applies to ${appliesTo(binding.target)}.`,
    });
  }
  if (!isLoader(load)) {
    throw new DeclarationError(notAFunction, {
      correction: "Supply load: () => import('./source.js').",
      findings: [keyFinding('load')],
      sentence: `${sentence} declares a source with no load function.`,
    });
  }
  const carrier = own.inputs.find((input) =>
    Object.hasOwn(own.build.records.get(input) ?? {}, binding.identity),
  );
  if (carrier) {
    const option = pluginOptionSite(
      { identity, options: declaration.options },
      carrier.name,
      `${sentence} option ${quoted(carrier.name)}`,
    );
    throw new DeclarationError(sourceBoundOwnOption, {
      correction: "Remove the value; the source's own options resolve before it loads.",
      findings: [partFinding(option, ['extensions'])],
      sentence: `${option.subject} carries its own source binding.`,
    });
  }
  return { binding: binding.identity, load };
}

/** One plugin's declarations, read once at its `plugin()` call. */
interface BuiltPlugin {
  theme: Palette | undefined;
  /** The hook core calls once per Command at graph build, or nothing where none is declared. */
  onCommandAttach: CommandAttachHook | undefined;
  /** The hook core calls for each failure `run()` renders after graph build, or nothing. */
  onFailure: FailureHook | undefined;
  /** The plugin's own `views` slot, read once the validated theme is in place. */
  views: unknown;
  /** The translations the plugin registers, which resolve after the application's. */
  translators: TranslationContributor;
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
  const site = pluginSlot(identity, 'extensions', extensions);
  if (extensions !== undefined && !Array.isArray(extensions)) {
    throw new DeclarationError(notAList, {
      correction: 'Supply a list of extension descriptors.',
      findings: [partFinding(site, [])],
      sentence: `${pluginSentence(identity)} declares extensions that are not an array.`,
    });
  }
  for (const [index, descriptor] of (extensions ?? []).entries()) {
    if (!isDescriptor(descriptor)) {
      throw new DeclarationError(foreignValue, {
        correction: 'Supply the value returned by extension(identity, config).',
        findings: [partFinding(site, [index])],
        sentence: `${pluginSentence(identity)} holds a value that is not an extension.`,
      });
    }
    registerDescriptor(build.descriptors, descriptor, partFinding(site, [index]));
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
  const onFailure = readFailureHook(named, declaration.onFailure);
  buildViews(pluginViews(named), declaration.views, viewIdentities(coreViews));
  const translators = readTranslations(
    pluginSlot(named, 'translators', declaration.translators),
    declaration.translators,
  );
  return {
    commands,
    descriptors: build.descriptors,
    identity: named,
    inputs,
    middleware,
    onCommandAttach,
    onFailure,
    records: build.records,
    signals,
    source,
    theme,
    translators,
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

/** One plugin option's value for one run: what a tier supplied, or the declared default. */
function pluginValue({ config, name }: OptionInput, values: OptionValues) {
  const declared: unknown = config.default;
  if (config.type === 'boolean') {
    return booleanValue(values, name, config);
  }
  if (config.multiple === true) {
    return collectedValue(values.lists.get(name), declared);
  }
  // Build already proved that a string option without a validator declares a string default.
  return values.strings.get(name) ?? (typeof declared === 'string' ? declared : undefined);
}

/**
 * One plugin's own option values for one run: what argv or an input source supplied, or the
 * declared default, filled without validation. A collected value and an array default are copied,
 * so a plugin that writes to what it received changes neither the declaration nor the next run.
 * Entries become own keys even for a name such as `__proto__`, which assignment would not.
 */
function pluginValues(inputs: readonly OptionInput[], values: OptionValues): PluginValues {
  return Object.fromEntries(inputs.map((input) => [input.name, pluginValue(input, values)]));
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
  PluginValues,
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
export {
  installPlugins,
  loadDefault,
  ownedSignals,
  plugin,
  pluginSentence,
  pluginSpellings,
  pluginViews,
  pluginValues,
};
