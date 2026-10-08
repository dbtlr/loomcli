import { registerRule } from './diagnostic-text.js';

/*
 * Core's own rules for the defects it raises, the run-time declaration faults it finds, and the
 * faults of the two things an author declares to describe a failure: a failure class's exit code
 * and a diagnostic rule. Each is declared once here and shared by every site that raises it, as a
 * plugin's rules are.
 */

/** A value thrown from an action, a middleware, or a source that no translator answered. */
const foreignThrow = registerRule('@loomcli/core/foreign-throw', {
  explanation:
    'Core reports a value that an action, a middleware, or a configuration source threw, and that no translator answered, as a defect, because only the author knows what it means. A distributed build shows the operator one generic message in its place.',
  headline: 'Unhandled exception',
});

/** The fix every foreign throw shares. */
const foreignThrowCorrection =
  'Catch the error where it is thrown and throw a failure class, such as FatalError, with a sentence the operator can act on.';

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

/** The fix every broken translator shares. */
const brokenTranslatorCorrection =
  'Return a failure, or undefined to pass, and throw nothing from the translator.';

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

/** A middleware that assigned `view` a name the routed Command's result cannot render. */
const viewSelection = registerRule('@loomcli/core/view-selection', {
  explanation:
    "A middleware, or the caller of invoke(), selects one of the views the routed Command's result declares, by name, before the action runs. A Command that declares no result has no view to select, and a name its result does not declare has no view to render.",
  headline: 'Invalid view selection',
});

/** The fix every invalid view selection a middleware made shares. */
const viewSelectionCorrection =
  "Assign view one of the view names the routed Command's result declares, and only on a Command that declares a result.";

/** The fix every invalid starting view an `invoke()` caller selected shares. */
const invokeViewCorrection = "Supply a view name the Command's result declares.";

/** A `run()` option that holds a value of the wrong kind. */
const runOptions = registerRule('@loomcli/core/run-options', {
  explanation:
    'run() reads its options before it builds the graph. A caller that embeds the application, such as a test, passes them, and a value of the wrong kind leaves the run nothing to act on.',
  headline: 'Invalid run options',
});

/** Release facts the build baked into `__LOOM_RELEASE__` that core cannot read. */
const invalidReleaseFacts = registerRule('@loomcli/core/invalid-release-facts', {
  explanation:
    'The build bakes the release facts into __LOOM_RELEASE__: a build of source, development, or distributed, and an optional release group with a semantic version, a repository as owner/name, and an optional asset name. A malformed value leaves the build unknown, so core shows the author this diagnostic in every build.',
  headline: 'Invalid release facts',
});

/** An `invoke()` call that holds a value of the wrong kind in one of its slots. */
const invokeOptions = registerRule('@loomcli/core/invoke-options', {
  explanation:
    'invoke() reads its path, values, and options before it builds the graph. A caller that runs a Command by name, such as an agent protocol or a test, passes them, and a value of the wrong kind leaves the call nothing to act on.',
  headline: 'Invalid invoke options',
});

/** A configuration source whose answers break the answers rule. */
const sourceAnswers = registerRule('@loomcli/core/source-answers', {
  explanation:
    'A configuration source answers with a record that maps each option core requested to { value, label }, where the value has the raw type the option takes and the label is one line of prose. Core fills no option from any other answer.',
  headline: 'Invalid source answers',
});

/** The fix every source answers fault shares. */
const sourceAnswersCorrection =
  "Return a record that maps each requested option's name to { value, label }, with a value of the option's raw type.";

/** A graph that `inspect()` did not return, or whose nodes disagree with the build it came from. */
const foreignGraph = registerRule('@loomcli/core/foreign-graph', {
  explanation:
    'Core reads a Command graph through the build inspect() rendered it from. A graph inspect() did not return, or one whose nodes do not match that build, leaves core no build to read, so the run stops rather than hand a plugin the wrong Command.',
  headline: 'Graph not from inspect()',
});

/** The fix every foreign graph shares. */
const foreignGraphCorrection = 'Pass the graph inspect() returned, unchanged.';

/** A host stream that failed a write the run owed it. */
const brokenDestination = registerRule('@loomcli/core/broken-destination', {
  explanation:
    "Core writes the run's output and its failure reports to the host streams run() captured. A stream that fails a write loses whatever followed it, so the run cannot succeed.",
  headline: 'Broken destination',
});

/** A failure class whose exit code is outside 1 through 125. */
const failureExitCode = registerRule('@loomcli/core/failure-exit-code', {
  explanation:
    "A failure's exit code tells the shell how the run ended: 0 means success, and 126 and above belong to the shell and to signals, so a failure exits with a code from 1 through 125. Core never clamps or replaces the code a failure class declares, so a code no failure may exit with is rejected where the class is first constructed.",
  headline: 'Undeclarable exit code',
});

/** A failure class whose failure code is outside the kebab-case grammar. */
const failureCode = registerRule('@loomcli/core/failure-code', {
  explanation:
    "A failure's code tells a script or an agent which failure ended the run, where many failures share one exit code. A machine reader branches on the code, so it follows one grammar: words of lowercase letters and digits joined by single hyphens. A code outside it is rejected where the class is first constructed.",
  headline: 'Invalid failure code',
});

/** A failure encoder that threw or returned a value that is not a string. */
const brokenFailureEncoder = registerRule('@loomcli/core/broken-failure-encoder', {
  explanation:
    "A failure encoder turns a failure's form into the text a machine reader parses, synchronously and without throwing. Core wrote its own text for the failure in the encoder's place.",
  headline: 'Broken failure encoder',
});

/** A diagnostic rule identity outside the `<package>[/<subpath>...]/<kebab-case-rule>` grammar. */
const ruleIdentity = registerRule('@loomcli/core/rule-identity', {
  explanation:
    "A rule's identity names the package that declares it and the rule inside it, so tooling keys on it and two packages never share one. It is an identity, a package name and any kebab-case subpath segments that name the part of the package that owns the rule, then a kebab-case rule name, joined by /.",
  headline: 'Invalid rule identity',
});

/** A diagnostic rule whose headline or explanation holds no prose. */
const ruleProse = registerRule('@loomcli/core/rule-prose', {
  explanation:
    "A rule's banner prints its headline, and its explanation teaches why the rule exists, so each holds prose.",
  headline: 'Empty rule text',
});

/** A diagnostic rule whose docs value is not a web address. */
const ruleDocs = registerRule('@loomcli/core/rule-docs', {
  explanation:
    "A diagnostic prints a rule's docs as a link the author follows, so it is an absolute http or https URL.",
  headline: 'Invalid rule docs',
});

export {
  brokenDestination,
  brokenFailureEncoder,
  brokenFailureHook,
  brokenFailureView,
  brokenOutputView,
  brokenTranslator,
  brokenTranslatorCorrection,
  failureCode,
  failureExitCode,
  foreignGraph,
  foreignGraphCorrection,
  foreignThrow,
  foreignThrowCorrection,
  invalidReleaseFacts,
  invokeOptions,
  invokeViewCorrection,
  nextMisuse,
  pluginLoaderFailed,
  resultContract,
  ruleDocs,
  ruleIdentity,
  ruleProse,
  runOptions,
  sourceAnswers,
  sourceAnswersCorrection,
  unconstructedFailure,
  validatorFailed,
  viewCorrection,
  viewSelection,
  viewSelectionCorrection,
};
