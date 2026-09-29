import { registerRule } from './diagnostic-text.js';

/*
 * Core's own rules for the defects it raises and the run-time declaration faults it finds. Each is
 * declared once here and shared by every site that raises it, as a plugin's rules are.
 */

/** A value thrown from an action, a middleware, or a source that no translator answered. */
const foreignThrow = registerRule('@loomcli/core/foreign-throw', {
  explanation:
    'Core reports a value that an action, a middleware, or a configuration source threw, and that no translator answered, as a defect, because only the author knows what it means. A distributed build shows the operator one generic message in its place.',
  headline: 'Unhandled exception',
});

/** The fixes every foreign throw shares. */
const foreignThrowCorrection: readonly string[] = [
  'Catch the error where it is thrown and throw a failure class, such as FatalError, with a sentence the operator can act on.',
  'Register a translator for its class with translate(ErrorClass, translator).',
];

/** A thrown value that inherits from a failure class without having been constructed by one. */
const unconstructedFailure = registerRule('@loomcli/core/unconstructed-failure', {
  explanation:
    'A failure class records its exit code when a failure is constructed, so a value that only inherits from one, such as one made with Object.create(), carries no code core can trust.',
  headline: 'Failure never constructed',
});

/** A translator that threw or answered with something other than a failure. */
const brokenTranslator = registerRule('@loomcli/core/broken-translator', {
  explanation:
    'A translator turns a foreign throw into a failure synchronously. A throw, or any answer other than a failure or undefined, leaves core no failure to report, so it consults no later translator.',
  headline: 'Broken translator',
});

/** A failure view that threw or returned a value that is not a string. */
const brokenFailureView = registerRule('@loomcli/core/broken-failure-view', {
  explanation:
    "A failure view turns a failure into the text the operator reads, synchronously and without throwing. Core wrote its own text for the failure in the view's place.",
  headline: 'Broken failure view',
});

/** An output or lane view that threw or returned a value that is not a string. */
const brokenOutputView = registerRule('@loomcli/core/broken-output-view', {
  explanation:
    'A view turns a value into text synchronously and without throwing. Core wrote nothing for the call whose view broke, and a run whose output is incomplete cannot succeed.',
  headline: 'Broken output view',
});

/** The fix a broken failure view and a broken output view share. */
const viewCorrection =
  "Return a string from the view's render function, and throw nothing from it.";

/** An `onFailure` hook that threw or returned a value that is not hints. */
const brokenFailureHook = registerRule('@loomcli/core/broken-failure-hook', {
  explanation:
    "An onFailure hook adds hint lines under a failure, synchronously and without throwing. Core dropped this hook's hints and rendered the failure with every other plugin's.",
  headline: 'Broken failure hook',
});

/** A plugin's middleware or source loader that rejected or exported no default function. */
const pluginLoaderFailed = registerRule('@loomcli/core/plugin-loader-failed', {
  explanation:
    "Core loads a plugin's middleware or source module the first time a run reaches it, and the module owes its function as its default export.",
  headline: 'Plugin loader failed',
});

/** A middleware that called `next()` twice, or after it returned. */
const nextMisuse = registerRule('@loomcli/core/next-misuse', {
  explanation:
    'next() continues the middleware chain once, while the middleware that received it runs. A second call, or a call after the middleware returned, has no chain left to continue.',
  headline: 'next() misused',
});

/** An action or a plugin that broke the promise a declared result makes. */
const resultContract = registerRule('@loomcli/core/result-contract', {
  explanation:
    'A Command that declares a result promises its consumer one value, or one sequence of rows, that its action emits once through out.results().',
  headline: 'Result contract broken',
});

/** A validator that threw, rejected, or returned a malformed result. */
const validatorFailed = registerRule('@loomcli/core/validator-failed', {
  explanation:
    'Only an issue a validator returns states a validation verdict. A validator that throws, rejects, or returns anything but a Standard Schema result leaves core no verdict to report, so validation stops and the action does not run.',
  headline: 'Validator failed',
});

export {
  brokenFailureHook,
  brokenFailureView,
  brokenOutputView,
  brokenTranslator,
  foreignThrow,
  foreignThrowCorrection,
  nextMisuse,
  pluginLoaderFailed,
  resultContract,
  unconstructedFailure,
  validatorFailed,
  viewCorrection,
};
