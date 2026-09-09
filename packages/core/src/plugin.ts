import type { MiddlewareContext } from './chain.js';
import { DeclarationError } from './errors.js';
import type { FailureRenderer } from './errors.js';
import { buildExtensions, isDescriptor, registerDescriptor } from './extension.js';
import type { AnyExtension, DescriptorRegistry, ExtensionRecords } from './extension.js';
import { checkDescription } from './facts.js';
import type { OptionValue, PluginOptionConfig } from './types.js';
import { captureConfig, checkDeclarations } from './validation.js';
import type { OptionInput } from './validation.js';

/**
 * The declaration record a plugin contributes its options under: the parsing part of an option
 * config, keyed by option name. A plugin option carries no schema and no presence rule, so the
 * config type publishes neither, and build repeats the rule for a JavaScript author.
 */
type PluginOptions = Readonly<Record<string, PluginOptionConfig>>;

/** The values one plugin's own options take, read through the same rules an action's options are. */
type PluginOptionValues<Options extends PluginOptions> = {
  readonly [Name in keyof Options]: OptionValue<Options[Name]>;
};

/** Phantom key. It carries a plugin's declared options in a read position and holds no value. */
declare const pluginOptions: unique symbol;

/**
 * One plugin's declarations as the registry holds them, with the generic parts erased. Build reads
 * every one of them defensively, because a JavaScript author reaches the same slots, so the erased
 * shape is what the rules below read and no declaration is claimed to be well formed here.
 */
interface DeclaredPlugin {
  options?: PluginOptions;
  middleware?: { activate?: unknown; load?: unknown };
  extensions?: readonly AnyExtension[];
  failures?: readonly FailureRenderer[];
  signals?: unknown;
}

/** The declarations behind one plugin value, read by this package alone. */
interface PluginNode {
  definition: DeclaredPlugin;
  identity: unknown;
}

/** Authored values register here, so the public type publishes no state to reach or replace. */
const nodes = new WeakMap<object, PluginNode>();

/**
 * The runtime value `plugin()` returns. `Options` appears in a read position alone, which makes it
 * covariant: a `plugins` list holds plugins with different options the way `failures` holds
 * renderers for different classes, and `Middleware` and `load` accept a narrower plugin.
 */
class PluginDeclaration<Options extends PluginOptions> {
  declare readonly [pluginOptions]: () => Options;

  constructor(node: PluginNode) {
    nodes.set(this, node);
    Object.freeze(this);
  }
}

/**
 * One plugin, as the opaque value `plugin()` returns. The declarations behind it stay private to
 * this package, so no consumer can read or replace them.
 */
type Plugin<Options extends PluginOptions = PluginOptions> = Pick<
  PluginDeclaration<Options>,
  typeof pluginOptions
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

/** Everything a plugin declares. It holds declarations alone and performs no work. */
interface PluginDefinition<Options extends PluginOptions = PluginOptions> {
  options?: Options;
  middleware?: {
    activate: 'always' | readonly (keyof Options & string)[];
    load: () => Promise<{ default: Middleware<Plugin<Options>> }>;
  };
  extensions?: readonly AnyExtension[];
  failures?: readonly FailureRenderer[];
  signals?: readonly ('SIGINT' | 'SIGTERM')[];
}

/**
 * One plugin: an identity and the declarations it contributes. The value performs no work when it
 * is created and none when it is installed, so an installed plugin an invocation never reaches
 * costs that invocation nothing.
 */
function plugin<Options extends PluginOptions = PluginOptions>(
  identity: string,
  definition: PluginDefinition<Options>,
): Plugin<Options> {
  return new PluginDeclaration<Options>({ definition, identity });
}

/** One installed plugin, with the declarations build reads out of it in installation order. */
interface InstalledPlugin {
  declaration: DeclaredPlugin;
  identity: string;
}

/** How every plugin diagnostic names one plugin at the start of a sentence. */
function pluginSentence(identity: string): string {
  return `Plugin "${identity}"`;
}

/** Reads the declarations behind an installed value; anything else is a declaration error. */
function nodeOf(value: unknown): PluginNode {
  const node = typeof value === 'object' && value !== null ? nodes.get(value) : undefined;
  if (!node) {
    throw new DeclarationError(
      'The Application holds a value that is not a plugin. Supply the value returned by plugin(identity, definition).',
    );
  }
  return node;
}

/** The identity one installed value declares, which is a nonempty string installed once. */
function readIdentity(value: unknown, installed: ReadonlySet<string>): string {
  const { identity } = nodeOf(value);
  if (typeof identity !== 'string' || identity === '') {
    throw new DeclarationError(
      'A plugin declares an empty identity. Supply a nonempty string, such as the package name.',
    );
  }
  if (installed.has(identity)) {
    throw new DeclarationError(
      `The Application installs plugin "${identity}" twice. Install each plugin once.`,
    );
  }
  return identity;
}

/**
 * The installed list in composition order, with the rules that read the list itself. Each plugin's
 * own declarations are read by the build steps that consume them, in the order those steps run.
 */
function installPlugins(plugins: readonly Plugin[]): readonly InstalledPlugin[] {
  const installed: InstalledPlugin[] = [];
  const identities = new Set<string>();
  for (const value of plugins) {
    const identity = readIdentity(value, identities);
    identities.add(identity);
    installed.push({ declaration: nodeOf(value).definition, identity });
  }
  return installed;
}

/** The keys a plugin option may not declare, in the order its diagnostic names them. */
const forbidden = ['validate', 'validateOmitted', 'required'] as const;

/** The rules a plugin option answers before every rule an ordinary declaration carries. */
function checkPluginOption(sentence: string, config: PluginOptionConfig): void {
  if (config === null || typeof config !== 'object') {
    return;
  }
  const rejected = forbidden.find((key) => key in config);
  if (rejected !== undefined) {
    throw new DeclarationError(
      `${sentence} declares ${rejected}. Remove it; a plugin option carries no schema or presence rule, and the middleware interprets the value.`,
    );
  }
  checkDescription(sentence, config.description);
}

/**
 * One plugin's option declarations, in declaration order. They join the globals table, so the rules
 * that pair them with another scope's options belong to that table and not to this reading.
 */
function readOptions(
  identity: string,
  declared: PluginOptions | undefined,
  build: PluginBuild,
): readonly OptionInput[] {
  const inputs: OptionInput[] = [];
  for (const [name, config] of Object.entries(declared ?? {})) {
    const sentence = `${pluginSentence(identity)} option "${name}"`;
    checkPluginOption(sentence, config);
    const input: OptionInput = { config: captureConfig(config), kind: 'option', name };
    checkDeclarations([input]);
    build.extensions.set(
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
  const activate = readActivation(identity, declared.activate, names);
  const { load } = declared;
  if (!isLoader(load)) {
    throw new DeclarationError(
      `${pluginSentence(identity)} declares middleware with no load function. Supply load: () => import('./middleware.js').`,
    );
  }
  return { activate, load };
}

/** One installed plugin's declarations, read once per build in installation order. */
interface BuiltPlugin {
  failures: readonly FailureRenderer[];
  identity: string;
  inputs: readonly OptionInput[];
  middleware: BuiltMiddleware | undefined;
  signals: unknown;
}

/** The shared registers one build fills while it reads each plugin's contributions. */
interface PluginBuild {
  descriptors: DescriptorRegistry;
  extensions: ExtensionRecords;
}

/** A plugin's own list names the extensions it defines, before any declaration carries one. */
function defineExtensions(identity: string, declaration: DeclaredPlugin, build: PluginBuild): void {
  for (const descriptor of declaration.extensions ?? []) {
    if (!isDescriptor(descriptor)) {
      throw new DeclarationError(
        `${pluginSentence(identity)} holds a value that is not an extension. Supply the value returned by extension(identity, config).`,
      );
    }
    registerDescriptor(build.descriptors, descriptor);
  }
}

/**
 * Every installed plugin's declarations, in installation order. A plugin's own extensions register
 * before any declaration carries a value, so a duplicated package copy is reported from the list
 * that installed it.
 */
function buildPlugins(
  installed: readonly InstalledPlugin[],
  build: PluginBuild,
): readonly BuiltPlugin[] {
  return installed.map(({ declaration, identity }) => {
    defineExtensions(identity, declaration, build);
    const inputs = readOptions(identity, declaration.options, build);
    const names = new Set(inputs.map((input) => input.name));
    return {
      failures: declaration.failures ?? [],
      identity,
      inputs,
      middleware: readMiddleware(identity, declaration.middleware, names),
      signals: declaration.signals,
    };
  });
}

export type {
  BuiltPlugin,
  InstalledPlugin,
  Middleware,
  OptionsOf,
  Plugin,
  PluginBuild,
  PluginDefinition,
  PluginOptions,
  PluginOptionValues,
};
export { buildPlugins, installPlugins, plugin, pluginSentence };
