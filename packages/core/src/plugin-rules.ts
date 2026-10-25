import { registerRule } from './diagnostic-text.js';

/*
 * Core's rules for the declaration faults of plugins, extensions, views, translators, lifecycle
 * hooks, and the Application options that install them. Each is declared once here and shared by
 * every site that raises it, as a plugin's rules are.
 */

/** A value another installed copy of `@loomcli/core` built, which this copy's registry misses. */
const foreignValue = registerRule('@loomcli/core/foreign-value', {
  explanation:
    'Core reads a plugin, an extension value, a declared view, a view override, a translation, a failure encoding, and a provider through facts the copy of @loomcli/core that built it recorded. When two copies of @loomcli/core are installed, a value one copy built carries no facts the other copy can read.',
  headline: 'Value from another copy of core',
});

/** The fix every foreign-value diagnostic shares. */
const foreignValueCorrection =
  'Install one copy of @loomcli/core, so the Application and every plugin package share it.';

/** One plugin identity installed twice. */
const pluginInstalledTwice = registerRule('@loomcli/core/plugin-installed-twice', {
  explanation:
    'Core keys each plugin by its identity, and a plugin contributes its options, middleware, hooks, and views once, so a second installation would contribute each of them again.',
  headline: 'Plugin installed twice',
});

/** A second plugin claiming the theme or the configuration source slot. */
const slotTaken = registerRule('@loomcli/core/slot-taken', {
  explanation:
    'A slot is a position exactly one plugin claims: the theme and the configuration source. A second claim would leave two plugins answering where core asks one.',
  headline: 'Slot already claimed',
});

/** Two failure encoders for one media type, in one plugin or across two installed plugins. */
const failureEncoderTaken = registerRule('@loomcli/core/failure-encoder-taken', {
  explanation:
    'A failed run writes its failure through the one encoder registered for the media type its selected view declares. Two encoders for one media type leave core no way to choose between them.',
  headline: 'Failure encoder taken',
});

/** Two distinct objects under one extension or declared-view identity. */
const twoPackageCopies = registerRule('@loomcli/core/two-package-copies', {
  explanation:
    'Core keys each extension and each declared view by its identity and compares it by reference. Two distinct objects under one identity mean two copies of the package that defines it are installed, and a value one copy made cannot be read through the other.',
  headline: 'Two copies of one package',
});

/** An extension value its schema rejects, by an issue or by a throw, or answers asynchronously. */
const invalidExtensionValue = registerRule('@loomcli/core/invalid-extension-value', {
  explanation:
    "An extension value passes its descriptor's schema at the call that carries it, synchronously, so every plugin that reads it reads a value the schema accepted.",
  headline: 'Invalid extension value',
});

/** An extension output that is not plain data. */
const extensionOutput = registerRule('@loomcli/core/extension-output', {
  explanation:
    "Every projection, the manifest included, reads an extension's output as frozen plain data: strings, finite numbers, Booleans, null, arrays, and plain objects.",
  headline: 'Extension output not plain data',
});

/** An `onCommandAttach` hook that threw something other than a `DeclarationError`. */
const brokenAttachHook = registerRule('@loomcli/core/broken-attach-hook', {
  explanation:
    "onCommandAttach receives each Command's declaration at graph build and returns it, or a value derived from it, synchronously and without throwing. Core builds the Command the hook returns, so a throw leaves it nothing to build.",
  headline: 'Broken attach hook',
});

/** An `onGraphBuilt` hook that threw something other than a `DeclarationError`. */
const brokenGraphHook = registerRule('@loomcli/core/broken-graph-hook', {
  explanation:
    'onGraphBuilt receives the frozen graph once per build and judges it: it returns nothing, and it rejects the graph only by throwing a DeclarationError. Any other throw is a defect in the hook.',
  headline: 'Broken graph hook',
});

export {
  brokenAttachHook,
  brokenGraphHook,
  extensionOutput,
  failureEncoderTaken,
  foreignValue,
  foreignValueCorrection,
  invalidExtensionValue,
  pluginInstalledTwice,
  slotTaken,
  twoPackageCopies,
};
