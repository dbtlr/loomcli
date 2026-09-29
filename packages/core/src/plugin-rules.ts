import { registerRule } from './diagnostic-text.js';

/*
 * Core's rules for the declaration faults of plugins, extensions, views, translators, lifecycle
 * hooks, and the Application options that install them. Each is declared once here and shared by
 * every site that raises it, as a plugin's rules are.
 */

/** A slot that holds a list, such as `plugins` or `commands`, holding a value of another kind. */
const notAList = registerRule('@loomcli/core/not-a-list', {
  explanation:
    'Core reads plugins, commands, extensions, views, translators, and signals each as a list, in order. A value of any other kind has no entries to read.',
  headline: 'Not a list',
});

/**
 * A declaration core reads by its keys, such as a plugin's middleware or a constructor's options,
 * that is not an object.
 */
const notAnObject = registerRule('@loomcli/core/not-an-object', {
  explanation:
    "Core reads the options of a Command and of the Application, a plugin's definition, its options record, each of its option declarations, its middleware, its source, and the config of an argument or option by their keys. A value of any other kind has no keys to read.",
  headline: 'Not an object',
});

/** A list entry that its factory did not build, such as a hand-made plugin or translation. */
const foreignValue = registerRule('@loomcli/core/foreign-value', {
  explanation:
    'Core reads a plugin, an extension, an extension value, a declared view, a view override, and a translation through facts its factory recorded when it built the value. Any other value carries none, even one of the same shape.',
  headline: 'Value not from its factory',
});

/** One plugin identity installed twice. */
const pluginInstalledTwice = registerRule('@loomcli/core/plugin-installed-twice', {
  explanation:
    'Core keys each plugin by its identity, and a plugin contributes its options, middleware, hooks, and views once, so a second installation would contribute each of them again.',
  headline: 'Plugin installed twice',
});

/** A second plugin claiming the theme, the signals, or the configuration source slot. */
const slotTaken = registerRule('@loomcli/core/slot-taken', {
  explanation:
    'A slot is a position exactly one plugin claims: the theme, the process signals, and the configuration source. A second claim would leave two plugins answering where core asks one.',
  headline: 'Slot already claimed',
});

/** A plugin, extension, or view identity outside the identity grammar. */
const invalidIdentity = registerRule('@loomcli/core/invalid-identity', {
  explanation:
    'An identity keys what a plugin, an extension, or a view contributes, names it in every diagnostic, and prefixes the identities of the rules its package declares. So it is a package name as npm spells one, scoped or not, then any subpath segments, each after a / and each of lowercase letters and digits in words joined by single hyphens.',
  headline: 'Invalid identity',
});

/** A validator or a presence rule on a plugin option. */
const pluginOptionRule = registerRule('@loomcli/core/plugin-option-rule', {
  explanation:
    "A plugin's middleware interprets its own options' values, so a plugin option declares how it parses and nothing more: no validator and no presence rule.",
  headline: 'Rule on a plugin option',
});

/** A middleware activation that is missing, empty, or names an option the plugin lacks. */
const middlewareActivation = registerRule('@loomcli/core/middleware-activation', {
  explanation:
    "Activation decides when core loads a plugin's middleware: on every run with 'always', or only when an invocation supplies one of the plugin's own options the list names, so a middleware no invocation needs costs it nothing.",
  headline: 'Invalid middleware activation',
});

/** A loader, a hook, or a translator that core cannot call. */
const notAFunction = registerRule('@loomcli/core/not-a-function', {
  explanation:
    'Core calls each of these values at a point of its own: load when a run first reaches a middleware or a source, onCommandAttach at graph build, onFailure when a failure renders, and a translator when a foreign throw reaches it. A value core cannot call leaves it nothing to run.',
  headline: 'Not a function',
});

/** A claimed signal outside SIGINT and SIGTERM. */
const unknownSignal = registerRule('@loomcli/core/unknown-signal', {
  explanation:
    'Core installs listeners for SIGINT and SIGTERM alone, the two signals that ask a command-line program to stop, so a plugin claims one of those.',
  headline: 'Unknown signal',
});

/** One signal claimed twice by one plugin. */
const signalClaimedTwice = registerRule('@loomcli/core/signal-claimed-twice', {
  explanation:
    'Core installs one listener for each signal a plugin claims, and a second listener on one signal would take the forced path on the first signal the run receives.',
  headline: 'Signal claimed twice',
});

/** A configuration source binding that is not one of the plugin's option extensions. */
const sourceBinding = registerRule('@loomcli/core/source-binding', {
  explanation:
    'A configuration source answers the options that carry its binding, an extension the plugin lists under extensions that applies to options. Core asks the source about those options without knowing what the binding means.',
  headline: 'Invalid source binding',
});

/** A plugin option that carries its own plugin's source binding. */
const sourceBoundOwnOption = registerRule('@loomcli/core/source-bound-own-option', {
  explanation:
    "A plugin's own options resolve before its configuration source loads, because the source reads them, so none of them can take a value from that source.",
  headline: 'Source bound to its own option',
});

/** Two distinct objects under one extension or declared-view identity. */
const twoPackageCopies = registerRule('@loomcli/core/two-package-copies', {
  explanation:
    'Core keys each extension and each declared view by its identity and compares it by reference. Two distinct objects under one identity mean two copies of the package that defines it are installed, and a value one copy made cannot be read through the other.',
  headline: 'Two copies of one package',
});

/** A descriptor with no Standard Schema. */
const extensionWithoutSchema = registerRule('@loomcli/core/extension-without-schema', {
  explanation:
    "Core validates each extension value against its descriptor's Standard Schema at the call that carries it, so a descriptor with no schema leaves the value unchecked.",
  headline: 'Extension without a schema',
});

/** An extension value on a declaration its descriptor does not target. */
const extensionTarget = registerRule('@loomcli/core/extension-target', {
  explanation:
    'An extension is defined for one target, Commands, options, or arguments, and a typed read takes that kind of node alone, so a value on another kind would never be read.',
  headline: 'Extension on the wrong target',
});

/** Two values of one extension in one layer. */
const extensionValueTwice = registerRule('@loomcli/core/extension-value-twice', {
  explanation:
    'One extensions list or one extend() call sets each extension once, collecting or not, so two values of one extension leave it unclear which the author meant.',
  headline: 'Extension value twice',
});

/** An extension value its schema rejects, by an issue or by a throw. */
const invalidExtensionValue = registerRule('@loomcli/core/invalid-extension-value', {
  explanation:
    "An extension value passes its descriptor's schema at the call that carries it, so every plugin that reads it reads a value the schema accepted.",
  headline: 'Invalid extension value',
});

/** An extension schema that answers with a promise. */
const asyncExtensionSchema = registerRule('@loomcli/core/async-extension-schema', {
  explanation:
    'Core validates extension values synchronously while it builds the declaration, so a schema that answers with a promise leaves it no verdict to read.',
  headline: 'Asynchronous extension schema',
});

/** An extension output that is not plain data. */
const extensionOutput = registerRule('@loomcli/core/extension-output', {
  explanation:
    "Every projection, the manifest included, reads an extension's output as frozen plain data: strings, finite numbers, Booleans, null, arrays, and plain objects.",
  headline: 'Extension output not plain data',
});

/** An override whose key is neither a declared view nor a failure class. */
const overrideKey = registerRule('@loomcli/core/override-key', {
  explanation:
    'An override replaces the view of a declared view or of a failure class, so its key is one of them.',
  headline: 'Invalid override key',
});

/** One key overridden twice inside one contributor. */
const overrideTwice = registerRule('@loomcli/core/override-twice', {
  explanation:
    'Within one contributor, one key answers to one override, so two leave it unclear which the author meant. The same key overridden by two contributors resolves to the first installed.',
  headline: 'Key overridden twice',
});

/** A `translate()` key that is not a class, or that is a failure class. */
const translationKey = registerRule('@loomcli/core/translation-key', {
  explanation:
    'A translation keys on the foreign error class it replaces. Core offers a translator only a thrown value no failure class made, so the key is a class and never a failure class.',
  headline: 'Invalid translation key',
});

/** An `onCommandAttach` hook that threw or returned a value that is not the attached Command. */
const brokenAttachHook = registerRule('@loomcli/core/broken-attach-hook', {
  explanation:
    "onCommandAttach receives each Command's declaration at graph build and returns it, or a value derived from it, synchronously and without throwing. Core builds the Command the hook returns, so a throw or any other value leaves it nothing to build.",
  headline: 'Broken attach hook',
});

/** The retired `globals` or `failures` Application option. */
const retiredApplicationOption = registerRule('@loomcli/core/retired-application-option', {
  explanation:
    'The Application no longer reads globals or failures. A global option is declared with globalOption(), so its type reaches every action, and a failure view is an override under views.',
  headline: 'Retired Application option',
});

/** A packet that is not an object, or whose build is neither value. */
const invalidPacket = registerRule('@loomcli/core/invalid-packet', {
  explanation:
    'The packet says whether the application was built for development, which decides whether a defect shows the author its Developer Diagnostic or the operator one generic message. Its build reads development or distributed.',
  headline: 'Invalid packet',
});

/** A rendering policy that is not an object, or holds a setting outside its closed set. */
const renderingPolicyRule = registerRule('@loomcli/core/rendering-policy', {
  explanation:
    'The rendering policy decides whether output carries color, modifiers, hyperlinks, and terminal controls. color, modifiers, and hyperlinks each read auto, always, or never, and terminalControls reads strip or preserve.',
  headline: 'Invalid rendering policy',
});

/** A plugin theme that is not a mapping of names to unapplied concrete style chains. */
const themeMapping = registerRule('@loomcli/core/theme-mapping', {
  explanation:
    "A plugin's theme maps each name to an unapplied chain of concrete styles. A semantic token reads the theme itself, so a chain that holds one has no concrete style to resolve to.",
  headline: 'Invalid theme mapping',
});

/** A theme name that a built-in style member already holds. */
const themeNameTaken = registerRule('@loomcli/core/theme-name-taken', {
  explanation:
    'Each theme name becomes a member of the style object beside the built-in members, so a name a built-in already holds would hide it.',
  headline: 'Theme name taken',
});

export {
  asyncExtensionSchema,
  brokenAttachHook,
  extensionOutput,
  extensionTarget,
  extensionValueTwice,
  extensionWithoutSchema,
  foreignValue,
  invalidExtensionValue,
  invalidIdentity,
  invalidPacket,
  middlewareActivation,
  notAFunction,
  notAList,
  notAnObject,
  overrideKey,
  overrideTwice,
  pluginInstalledTwice,
  pluginOptionRule,
  renderingPolicyRule,
  retiredApplicationOption,
  signalClaimedTwice,
  slotTaken,
  sourceBinding,
  sourceBoundOwnOption,
  themeMapping,
  themeNameTaken,
  translationKey,
  twoPackageCopies,
  unknownSignal,
};
